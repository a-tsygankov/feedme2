/**
 * House session (spec §3.2, gigsy's shape): the access token lives in
 * memory only; the refresh token and a house snapshot persist in
 * localStorage so the installed PWA reopens signed in. Three refresh
 * outcomes, because conflating "the server said no" with "no network"
 * once turned a flaky connection into a sign-out.
 */
import { HouseSchema, TokensResponseSchema, type House, type TokensResponse } from "@feedme2/shared";
import { safeStorage, type KeyValueStorage } from "./safe-storage.ts";

export type AuthSnapshot = { status: "signedOut" } | { status: "signedIn"; house: House };
export type RefreshOutcome = { ok: true } | { ok: false; reason: "rejected" | "unreachable" };

/**
 * True when cached server data no longer belongs to the session: signing out, or the house changing under a signed-in
 * user. Without this a second house on the same phone briefly saw the first house's cats from the persisted cache.
 * Signed-out to signed-in is not a boundary (the cache was already cleared when the previous session ended).
 */
export function crossesSessionBoundary(prev: AuthSnapshot, next: AuthSnapshot): boolean {
  if (prev.status !== "signedIn") return false;
  return next.status === "signedOut" || next.house.id !== prev.house.id;
}

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
  storage: KeyValueStorage;
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

  // Bumped by signOut and applyTokens: a refresh already in flight belongs to the
  // session it started in. After a sign-out it must not sign the user back in with
  // the tokens the server rotated a moment ago; after /qr applied another house's
  // tokens it must not put the phone back in the old house (security review, Phase 5a).
  let epoch = 0;

  const storedRefresh = read(REFRESH_KEY);
  const storedHouse = read(HOUSE_KEY);
  if (storedRefresh && storedHouse) {
    try {
      const parsed = HouseSchema.safeParse(JSON.parse(storedHouse));
      if (parsed.success) snapshot = { status: "signedIn", house: parsed.data };
    } catch { /* corrupt snapshot: handled below */ }
  }
  if (snapshot.status === "signedOut" && (storedRefresh || storedHouse)) {
    // A half-written or corrupt pair can never sign in; keeping it would
    // re-fail on every launch (and used to throw at import, blanking the app).
    write(REFRESH_KEY, null);
    write(HOUSE_KEY, null);
  }

  function set(next: AuthSnapshot): void {
    snapshot = next;
    for (const l of listeners) l();
  }

  const store: AuthStore = {
    subscribe(l) { listeners.add(l); return () => void listeners.delete(l); },
    getSnapshot: () => snapshot,
    applyTokens(t) {
      epoch++;
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
      epoch++;
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
        const startedEpoch = epoch;
        const refreshToken = read(REFRESH_KEY);
        if (!refreshToken) { store.signOut(); return { ok: false, reason: "rejected" }; }
        let res: Response;
        try {
          res = await deps.fetchFn("/api/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken }) });
        } catch {
          return { ok: false, reason: "unreachable" };
        }
        if (res.status === 401 || res.status === 400) {
          // A refusal of the previous session's token says nothing about the session that replaced it.
          if (epoch === startedEpoch) store.signOut();
          return { ok: false, reason: "rejected" };
        }
        if (!res.ok) return { ok: false, reason: "unreachable" };
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          // A captive portal or edge error page can answer 200 with HTML.
          return { ok: false, reason: "unreachable" };
        }
        const parsed = TokensResponseSchema.safeParse(body);
        if (!parsed.success) return { ok: false, reason: "unreachable" };
        // Checked before applying (applyTokens bumps the epoch itself).
        if (epoch !== startedEpoch) return { ok: false, reason: "rejected" };
        store.applyTokens(parsed.data);
        return { ok: true };
      })().finally(() => { inflight = null; });
      return inflight;
    },
  };
  return store;
}

export const authStore: AuthStore = createAuthStore({ storage: safeStorage(), fetchFn: (...a) => fetch(...a), now: Date.now });
