// @vitest-environment jsdom
// The modules under test build their singletons from localStorage at import time.
import { describe, expect, it, vi } from "vitest";
import type { RefreshOutcome } from "./auth-store.ts";
import { ApiError, NetworkError, createApiFetch } from "./api-client.ts";

/** access: successive getAccessToken() results (the last one repeats). */
function fakeAuth(access: Array<string | null>, refreshOutcome: RefreshOutcome) {
  let i = 0;
  return {
    getAccessToken: () => access[Math.min(i++, access.length - 1)] ?? null,
    refresh: vi.fn(async (): Promise<RefreshOutcome> => refreshOutcome),
    signOut: vi.fn(),
  };
}
const make = (fetchFn: unknown, auth: ReturnType<typeof fakeAuth>) =>
  createApiFetch({ fetchFn: fetchFn as typeof fetch, auth, clientId: "c" });
const sentInit = (fetchFn: ReturnType<typeof vi.fn>, n = 0) => fetchFn.mock.calls[n]![1] as RequestInit;

describe("apiFetch", () => {
  it("sends the bearer and client id", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const apiFetch = createApiFetch({ fetchFn: fetchFn as unknown as typeof fetch, auth: fakeAuth(["tok"], { ok: true }), clientId: "phone-1" });
    await apiFetch("/api/cats");
    const h = new Headers(sentInit(fetchFn).headers);
    expect(h.get("authorization")).toBe("Bearer tok");
    expect(h.get("x-client-id")).toBe("phone-1");
  });

  it("sets content-type only when there is a body", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const apiFetch = make(fetchFn, fakeAuth(["t"], { ok: true }));
    await apiFetch("/api/cats");
    await apiFetch("/api/cats", { method: "POST", body: "{}" });
    expect(new Headers(sentInit(fetchFn, 0).headers).has("content-type")).toBe(false);
    expect(new Headers(sentInit(fetchFn, 1).headers).get("content-type")).toBe("application/json");
  });

  it("keeps a caller's Headers instance and cannot have auth overridden by it", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const apiFetch = make(fetchFn, fakeAuth(["tok"], { ok: true }));
    // Spreading a Headers object into a plain literal silently drops every entry.
    await apiFetch("/api/cats", { headers: new Headers({ "x-trace": "abc", authorization: "Bearer evil", "x-client-id": "evil" }) });
    const h = new Headers(sentInit(fetchFn).headers);
    expect(h.get("x-trace")).toBe("abc");
    expect(h.get("authorization")).toBe("Bearer tok");
    expect(h.get("x-client-id")).toBe("c");
  });

  it("refreshes first when the access token is stale, then sends once", async () => {
    const fetchFn = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const auth = fakeAuth([null, "fresh"], { ok: true });
    const res = await make(fetchFn, auth)("/api/cats");
    expect(res.status).toBe(200);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(new Headers(sentInit(fetchFn).headers).get("authorization")).toBe("Bearer fresh");
  });

  it("refreshes after a 401 and retries once with the new token", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    // used "old"; still "old" when compared after the 401; "fresh" after refresh
    const auth = fakeAuth(["old", "old", "fresh"], { ok: true });
    const res = await make(fetchFn, auth)("/api/cats");
    expect(res.status).toBe(200);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(new Headers(sentInit(fetchFn, 1).headers).get("authorization")).toBe("Bearer fresh");
  });

  it("retries without refreshing when another request already replaced the token", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const auth = fakeAuth(["old", "newer"], { ok: true });
    await make(fetchFn, auth)("/api/cats");
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(new Headers(sentInit(fetchFn, 1).headers).get("authorization")).toBe("Bearer newer");
  });

  it("a second 401 after a good refresh signs out and throws ApiError(401)", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 401 }));
    const auth = fakeAuth(["old", "old", "fresh"], { ok: true });
    await expect(make(fetchFn, auth)("/api/cats")).rejects.toMatchObject({ status: 401 });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws ApiError with the status and body on a non-2xx that is not a 401", async () => {
    const fetchFn = vi.fn(async () => new Response('{"error":"name taken"}', { status: 409 }));
    await expect(make(fetchFn, fakeAuth(["t"], { ok: true }))("/api/house", { method: "PATCH" })).rejects.toMatchObject({ status: 409, body: { error: "name taken" } });
  });

  it("a 401 followed by a rejected refresh throws ApiError(401) and does not retry", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 401 }));
    const auth = fakeAuth(["t", "t"], { ok: false, reason: "rejected" });
    await expect(make(fetchFn, auth)("/api/cats")).rejects.toBeInstanceOf(ApiError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("an unreachable refresh surfaces as NetworkError, not a 401", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const auth = fakeAuth([null], { ok: false, reason: "unreachable" });
    const err = await make(fetchFn, auth)("/api/cats").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).name).toBe("NetworkError");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("an unreachable refresh after a 401 is also a NetworkError", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 401 }));
    const auth = fakeAuth(["t", "t"], { ok: false, reason: "unreachable" });
    await expect(make(fetchFn, auth)("/api/cats")).rejects.toBeInstanceOf(NetworkError);
  });

  it("a thrown fetch (network down) surfaces as NetworkError", async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(make(fetchFn, fakeAuth(["t"], { ok: true }))("/api/cats")).rejects.toBeInstanceOf(NetworkError);
  });

  it("lets an aborted request stay an AbortError", async () => {
    const fetchFn = vi.fn(async () => { throw new DOMException("aborted", "AbortError"); });
    await expect(make(fetchFn, fakeAuth(["t"], { ok: true }))("/api/cats")).rejects.toMatchObject({ name: "AbortError" });
  });
});
