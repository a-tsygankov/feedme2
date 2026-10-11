/**
 * House session (spec §3.2, gigsy's shape): the access token lives in
 * memory only; the refresh token and a house snapshot persist in
 * localStorage so the installed PWA reopens signed in. Three refresh
 * outcomes, because conflating "the server said no" with "no network"
 * once turned a flaky connection into a sign-out.
 */
import { HouseSchema, TokensResponseSchema, type House, type TokensResponse } from "@feedme2/shared";

export type AuthSnapshot = { status: "signedOut" } | { status: "signedIn"; house: House };
export type RefreshOutcome = { ok: true } | { ok: false; reason: "rejected" | "unreachable" };

export interface AuthStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AuthSnapshot;
  applyTokens(t: TokensResponse): void;
  updateHouse(house: House): void;
  signOut(): void;
  /** null when missing or within a minute of expiry — callers refresh. */
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  refresh(): Promise<RefreshOutcome>;
}

interface Deps {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  fetchFn: typeof fetch;
  now: () => number;
}

const REFRESH_KEY = "feedme2:refresh";
const HOUSE_KEY = "feedme2:house";
const EARLY_MS = 60_000;

export function createAuthStore(deps: Deps): AuthStore {
  let accessToken: string | null = null;
  let accessExpiresAt = 0;
  let snapshot: AuthSnapshot = { status: "signedOut" };
  let inflight: Promise<RefreshOutcome> | null = null;
  const listeners = new Set<() => void>();

  const read = (k: string) => { try { return deps.storage.getItem(k); } catch { return null; } };
  const write = (k: string, v: string | null) => { try { v === null ? deps.storage.removeItem(k) : deps.storage.setItem(k, v); } catch { /* private mode */ } };

  const storedHouse = read(HOUSE_KEY);
  if (read(REFRESH_KEY) && storedHouse) {
    const parsed = HouseSchema.safeParse(JSON.parse(storedHouse));
    if (parsed.success) snapshot = { status: "signedIn", house: parsed.data };
  }

  function set(next: AuthSnapshot): void {
    snapshot = next;
    for (const l of listeners) l();
  }

  const store: AuthStore = {
    subscribe(l) { listeners.add(l); return () => void listeners.delete(l); },
    getSnapshot: () => snapshot,
    applyTokens(t) {
      accessToken = t.accessToken;
      accessExpiresAt = deps.now() + t.expiresIn * 1000;
      write(REFRESH_KEY, t.refreshToken);
      write(HOUSE_KEY, JSON.stringify(t.house));
      set({ status: "signedIn", house: t.house });
    },
    updateHouse(house) {
      write(HOUSE_KEY, JSON.stringify(house));
      set({ status: "signedIn", house });
    },
    signOut() {
      accessToken = null;
      accessExpiresAt = 0;
      write(REFRESH_KEY, null);
      write(HOUSE_KEY, null);
      set({ status: "signedOut" });
    },
    getAccessToken() {
      if (accessToken === null || deps.now() >= accessExpiresAt - EARLY_MS) return null;
      return accessToken;
    },
    getRefreshToken: () => read(REFRESH_KEY),
    refresh() {
      // One refresh at a time: concurrent 401s must not each rotate.
      if (inflight) return inflight;
      inflight = (async (): Promise<RefreshOutcome> => {
        const refreshToken = read(REFRESH_KEY);
        if (!refreshToken) { store.signOut(); return { ok: false, reason: "rejected" }; }
        let res: Response;
        try {
          res = await deps.fetchFn("/api/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken }) });
        } catch {
          return { ok: false, reason: "unreachable" };
        }
        if (res.status === 401 || res.status === 400) { store.signOut(); return { ok: false, reason: "rejected" }; }
        if (!res.ok) return { ok: false, reason: "unreachable" };
        const parsed = TokensResponseSchema.safeParse(await res.json());
        if (!parsed.success) return { ok: false, reason: "unreachable" };
        store.applyTokens(parsed.data);
        return { ok: true };
      })().finally(() => { inflight = null; });
      return inflight;
    },
  };
  return store;
}

export const authStore: AuthStore = createAuthStore({ storage: localStorage, fetchFn: (...a) => fetch(...a), now: Date.now });
