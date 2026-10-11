// @vitest-environment jsdom
// The modules under test build their singletons from localStorage at import time.
import { describe, expect, it, vi } from "vitest";
import type { House, TokensResponse } from "@feedme2/shared";
import { createAuthStore } from "./auth-store.ts";

const house: House = {
  id: "123e4567-e89b-42d3-a456-426614174000", name: "Mochi House", createdAt: 1, modifiedAt: 1,
  settings: { foodUnit: "g", canSizeMg: 155922, canFractionStep: "1/4", gramStep: 5, ozStepHundredths: 25, hungryAfterSecDefault: 18000, sleepTimeoutSec: 300, syncIntervalSec: 21600, timezone: "UTC" },
};
const tokens = (n: number): TokensResponse => ({ accessToken: `a${n}`, expiresIn: 900, refreshToken: `r${n}`, house });

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("auth store", () => {
  it("starts signed out, signs in on tokens, persists only the refresh token and house", () => {
    const storage = memStorage();
    const store = createAuthStore({ storage, fetchFn: vi.fn() as unknown as typeof fetch, now: () => 0 });
    expect(store.getSnapshot()).toEqual({ status: "signedOut" });
    store.applyTokens(tokens(1));
    expect(store.getSnapshot()).toEqual({ status: "signedIn", house });
    expect(store.getAccessToken()).toBe("a1");
    expect(storage.getItem("feedme2:refresh")).toBe("r1");
    expect(storage.getItem("feedme2:house")).toContain("Mochi House");
    expect(storage.getItem("feedme2:access")).toBeNull();
  });

  it("rehydrates as signed in from storage with no access token until refresh", async () => {
    const storage = memStorage();
    storage.setItem("feedme2:refresh", "r9");
    storage.setItem("feedme2:house", JSON.stringify(house));
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(tokens(2)), { status: 200 })) as unknown as typeof fetch;
    const store = createAuthStore({ storage, fetchFn, now: () => 0 });
    expect(store.getSnapshot().status).toBe("signedIn");
    expect(store.getAccessToken()).toBeNull();
    expect(await store.refresh()).toEqual({ ok: true });
    expect(store.getAccessToken()).toBe("a2");
    expect(storage.getItem("feedme2:refresh")).toBe("r2");
  });

  it("a rejected refresh signs out; an unreachable one does not", async () => {
    const storage = memStorage();
    storage.setItem("feedme2:refresh", "r9");
    storage.setItem("feedme2:house", JSON.stringify(house));
    const rejected = createAuthStore({ storage, fetchFn: (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch, now: () => 0 });
    expect(await rejected.refresh()).toEqual({ ok: false, reason: "rejected" });
    expect(rejected.getSnapshot()).toEqual({ status: "signedOut" });
    storage.setItem("feedme2:refresh", "r9");
    storage.setItem("feedme2:house", JSON.stringify(house)); // the rejected sign-out cleared it
    const offline = createAuthStore({ storage, fetchFn: (async () => { throw new Error("offline"); }) as unknown as typeof fetch, now: () => 0 });
    expect(await offline.refresh()).toEqual({ ok: false, reason: "unreachable" });
    expect(offline.getSnapshot().status).toBe("signedIn");
  });

  it("treats the access token as stale a minute before expiry", () => {
    let t = 0;
    const store = createAuthStore({ storage: memStorage(), fetchFn: vi.fn() as unknown as typeof fetch, now: () => t });
    store.applyTokens(tokens(1));
    t = 13 * 60 * 1000;
    expect(store.getAccessToken()).toBe("a1");
    t = 14 * 60 * 1000 + 1;
    expect(store.getAccessToken()).toBeNull();
  });
});
