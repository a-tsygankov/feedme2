/**
 * The only place the webapp calls fetch for /api/*. Adds the bearer
 * and client id, refreshes a stale token before the call, retries once
 * after a 401, and turns every other non-2xx into ApiError.
 */
import {
  CatSchema, DeviceSchema, DevicesResponseSchema, FeedingSchema, FeedingsPageSchema, HouseSchema, DebugLogsResponseSchema,
  PairConfirmResponseSchema, TokensResponseSchema,
  type Cat, type CatCreate, type CatPatch, type DebugLogsQuery, type Feeding, type FeedingCreate, type FeedingPatch,
  type DevicePatch, type FeedingsPage, type House, type HousePatch, type LogEntry, type LogUploadEntry, type PairConfirmBody, type TokensResponse,
} from "@feedme2/shared";
import { z } from "zod";
import { authStore, type RefreshOutcome } from "./auth-store.ts";
import { getClientId } from "./client-id.ts";

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`API ${status}`);
  }
}

/** No usable connection (fetch threw, or a refresh could not reach the server).
 * Distinct from ApiError(401) so a flaky network is never shown as "signed out". */
export class NetworkError extends Error {
  constructor() {
    super("Network unreachable");
    this.name = "NetworkError";
  }
}

/** `body` may be a thunk, evaluated per send AFTER any stale-token refresh (sign-out reads the rotated refresh token). */
export type ApiInit = Omit<RequestInit, "body"> & { body?: RequestInit["body"] | (() => string) };

interface Deps {
  fetchFn: typeof fetch;
  auth: { getAccessToken(): string | null; refresh(): Promise<RefreshOutcome>; signOut(): void };
  clientId: string;
}

const unauthorized = () => new ApiError(401, { error: "unauthorized" });

export function createApiFetch(deps: Deps) {
  async function refreshOrThrow(): Promise<void> {
    const r = await deps.auth.refresh();
    if (r.ok) return;
    throw r.reason === "unreachable" ? new NetworkError() : unauthorized();
  }

  async function send(path: string, rawInit: ApiInit, token: string | null): Promise<Response> {
    const init: RequestInit = { ...rawInit, ...(typeof rawInit.body === "function" ? { body: rawInit.body() } : {}) } as RequestInit;
    const headers = new Headers(init.headers);
    // Only a string body is JSON here: forcing the type on FormData/Blob would strip the multipart boundary.
    if (typeof init.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
    // Set last so a caller-supplied header can never replace the session's identity.
    if (token) headers.set("authorization", `Bearer ${token}`); else headers.delete("authorization");
    headers.set("x-client-id", deps.clientId);
    try {
      return await deps.fetchFn(path, { ...init, headers });
    } catch (err) {
      // A caller-initiated abort is not a connectivity problem.
      if ((err as { name?: unknown } | null)?.name === "AbortError") throw err;
      throw new NetworkError();
    }
  }

  return async function apiFetch(path: string, init: ApiInit = {}): Promise<Response> {
    let token = deps.auth.getAccessToken();
    if (token === null) {
      await refreshOrThrow();
      token = deps.auth.getAccessToken();
    }
    let res = await send(path, init, token);
    if (res.status === 401) {
      // A concurrent request may already have rotated the token while ours was
      // in flight; refreshing again would burn the new refresh token for nothing.
      let next = deps.auth.getAccessToken();
      if (next === null || next === token) {
        await refreshOrThrow();
        next = deps.auth.getAccessToken();
      }
      res = await send(path, init, next);
      if (res.status === 401) {
        // A freshly issued token was refused too: the session is dead, not stale.
        deps.auth.signOut();
        throw unauthorized();
      }
    }
    if (!res.ok) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* no body */ }
      throw new ApiError(res.status, body);
    }
    return res;
  };
}

export const LOG_UPLOAD_TIMEOUT_MS = 15_000;

/**
 * Init for POST /api/logs: a timeout signal unless the caller brings its own. Without one a hung connection keeps the
 * upload sink's flush pending forever, and every later flush then joins it. A request that timed out may still have
 * been stored by the server, so the retry can duplicate lines: accepted, the console de-dupes them.
 */
export function logUploadInit(init: RequestInit): RequestInit {
  const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(LOG_UPLOAD_TIMEOUT_MS) : undefined;
  return { ...(signal ? { signal } : {}), ...init, method: "POST" };
}

export const apiFetch = createApiFetch({ fetchFn: (...a) => fetch(...a), auth: authStore, clientId: getClientId() });

/** Public (no token) POST used by setup/login/test-login. */
async function publicPost<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new NetworkError();
  }
  if (!res.ok) {
    let b: unknown = null;
    try { b = await res.json(); } catch { /* no body */ }
    throw new ApiError(res.status, b);
  }
  return schema.parse(await res.json());
}

async function json<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await res.json());
}

export const api = {
  setup: (houseName: string, pin: string): Promise<TokensResponse> => publicPost("/api/auth/setup", { houseName, pin }, TokensResponseSchema),
  login: (houseName: string, pin: string): Promise<TokensResponse> => publicPost("/api/auth/login", { houseName, pin }, TokensResponseSchema),
  testLogin: (houseName: string): Promise<TokensResponse> => publicPost("/api/auth/test-login", { houseName }, TokensResponseSchema),
  // The token is read when the request is built, after apiFetch has refreshed a stale access token: reading it before
  // would send the pre-rotation token and leave the rotated child live (an orphaned session).
  logout: () => apiFetch("/api/auth/logout", { method: "POST", body: () => JSON.stringify({ refreshToken: authStore.getRefreshToken() ?? "" }) }),
  me: () => apiFetch("/api/auth/me").then((r) => json(r, z.object({ house: HouseSchema }))).then((b) => b.house),
  changePin: (currentPin: string, newPin: string) => apiFetch("/api/auth/pin", { method: "PATCH", body: JSON.stringify({ currentPin, newPin }) }),
  getHouse: (): Promise<House> => apiFetch("/api/house").then((r) => json(r, z.object({ house: HouseSchema }))).then((b) => b.house),
  patchHouse: (patch: HousePatch): Promise<House> =>
    apiFetch("/api/house", { method: "PATCH", body: JSON.stringify(patch) }).then((r) => json(r, z.object({ house: HouseSchema }))).then((b) => b.house),
  listCats: (): Promise<Cat[]> => apiFetch("/api/cats").then((r) => json(r, z.object({ cats: z.array(CatSchema) }))).then((b) => b.cats),
  createCat: (input: CatCreate): Promise<Cat> =>
    apiFetch("/api/cats", { method: "POST", body: JSON.stringify(input) }).then((r) => json(r, z.object({ cat: CatSchema }))).then((b) => b.cat),
  patchCat: (id: string, patch: CatPatch): Promise<Cat> =>
    apiFetch(`/api/cats/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).then((r) => json(r, z.object({ cat: CatSchema }))).then((b) => b.cat),
  deleteCat: (id: string) => apiFetch(`/api/cats/${id}`, { method: "DELETE" }),
  listFeedings: (q: { cat?: string; from?: number; to?: number; cursor?: string; limit?: number } = {}): Promise<FeedingsPage> => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
    return apiFetch(`/api/feedings?${params}`).then((r) => json(r, FeedingsPageSchema));
  },
  // `init` lets the sync engine bound each call with an AbortSignal timeout.
  createFeedings: (items: FeedingCreate[], init: RequestInit = {}): Promise<{ accepted: string[]; feedings: Feeding[] }> =>
    apiFetch("/api/feedings", { ...init, method: "POST", body: JSON.stringify(items) }).then((r) => json(r, z.object({ accepted: z.array(z.string()), feedings: z.array(FeedingSchema) }))),
  patchFeeding: (id: string, patch: FeedingPatch, init: RequestInit = {}): Promise<Feeding> =>
    apiFetch(`/api/feedings/${id}`, { ...init, method: "PATCH", body: JSON.stringify(patch) }).then((r) => json(r, z.object({ feeding: FeedingSchema }))).then((b) => b.feeding),
  deleteFeeding: (id: string, init: RequestInit = {}) => apiFetch(`/api/feedings/${id}`, { ...init, method: "DELETE" }),
  // `init` lets the page-hide flush pass keepalive so the request outlives the page.
  uploadLogs: (entries: LogUploadEntry[], init: RequestInit = {}) => apiFetch("/api/logs", { ...logUploadInit(init), body: JSON.stringify(entries) }),
  debugLogs: (q: Partial<DebugLogsQuery> = {}): Promise<LogEntry[]> => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
    return apiFetch(`/api/debug/logs?${params}`).then((r) => json(r, DebugLogsResponseSchema)).then((b) => b.entries);
  },
  listDevices: () => apiFetch("/api/devices").then((r) => json(r, DevicesResponseSchema)),
  patchDevice: (id: string, patch: DevicePatch) =>
    apiFetch(`/api/devices/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).then((r) => json(r, z.object({ device: DeviceSchema }))),
  deleteDevice: (id: string): Promise<void> => apiFetch(`/api/devices/${id}`, { method: "DELETE" }).then(() => undefined),
  confirmPair: (body: PairConfirmBody) =>
    apiFetch("/api/pair/confirm", { method: "POST", body: JSON.stringify(body) }).then((r) => json(r, PairConfirmResponseSchema)),
};
