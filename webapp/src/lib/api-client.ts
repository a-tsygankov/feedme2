/**
 * The only place the webapp calls fetch for /api/*. Adds the bearer
 * and client id, refreshes a stale token before the call, retries once
 * after a 401, and turns every other non-2xx into ApiError.
 */
import {
  CatSchema, FeedingSchema, FeedingsPageSchema, HouseSchema, DebugLogsResponseSchema, TokensResponseSchema,
  type Cat, type CatCreate, type CatPatch, type DebugLogsQuery, type Feeding, type FeedingCreate, type FeedingPatch,
  type FeedingsPage, type House, type HousePatch, type LogEntry, type TokensResponse,
} from "@feedme2/shared";
import { z } from "zod";
import { authStore } from "./auth-store.ts";
import { getClientId } from "./client-id.ts";

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`API ${status}`);
  }
}

interface Deps {
  fetchFn: typeof fetch;
  auth: { getAccessToken(): string | null; refresh(): Promise<{ ok: boolean }> };
  clientId: string;
}

export function createApiFetch(deps: Deps) {
  return async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    let token = deps.auth.getAccessToken();
    if (token === null) {
      const r = await deps.auth.refresh();
      if (!r.ok) throw new ApiError(401, { error: "unauthorized" });
      token = deps.auth.getAccessToken();
    }
    const send = (t: string | null) =>
      deps.fetchFn(path, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(t ? { authorization: `Bearer ${t}` } : {}),
          "x-client-id": deps.clientId,
          ...(init.headers ?? {}),
        },
      });
    let res = await send(token);
    if (res.status === 401) {
      const r = await deps.auth.refresh();
      if (!r.ok) throw new ApiError(401, { error: "unauthorized" });
      res = await send(deps.auth.getAccessToken());
    }
    if (!res.ok) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* no body */ }
      throw new ApiError(res.status, body);
    }
    return res;
  };
}

export const apiFetch = createApiFetch({ fetchFn: (...a) => fetch(...a), auth: authStore, clientId: getClientId() });

/** Public (no token) POST used by setup/login/test-login. */
async function publicPost<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
  logout: (refreshToken: string) => apiFetch("/api/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }),
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
  createFeedings: (items: FeedingCreate[]): Promise<{ accepted: string[]; feedings: Feeding[] }> =>
    apiFetch("/api/feedings", { method: "POST", body: JSON.stringify(items) }).then((r) => json(r, z.object({ accepted: z.array(z.string()), feedings: z.array(FeedingSchema) }))),
  patchFeeding: (id: string, patch: FeedingPatch): Promise<Feeding> =>
    apiFetch(`/api/feedings/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).then((r) => json(r, z.object({ feeding: FeedingSchema }))).then((b) => b.feeding),
  deleteFeeding: (id: string) => apiFetch(`/api/feedings/${id}`, { method: "DELETE" }),
  uploadLogs: (entries: LogEntry[]) => apiFetch("/api/logs", { method: "POST", body: JSON.stringify(entries) }),
  debugLogs: (q: Partial<DebugLogsQuery> = {}): Promise<LogEntry[]> => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
    return apiFetch(`/api/debug/logs?${params}`).then((r) => json(r, DebugLogsResponseSchema)).then((b) => b.entries);
  },
};
