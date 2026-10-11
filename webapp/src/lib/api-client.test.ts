// @vitest-environment jsdom
// The modules under test build their singletons from localStorage at import time.
import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiFetch } from "./api-client.ts";

function fakeAuth(access: Array<string | null>, refreshOutcome: { ok: true } | { ok: false; reason: "rejected" | "unreachable" }) {
  let i = 0;
  return {
    getAccessToken: () => access[Math.min(i++, access.length - 1)] ?? null,
    refresh: vi.fn(async () => refreshOutcome),
  };
}

describe("apiFetch", () => {
  it("sends the bearer and client id", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const auth = fakeAuth(["tok"], { ok: true });
    const apiFetch = createApiFetch({ fetchFn: fetchFn as unknown as typeof fetch, auth, clientId: "phone-1" });
    await apiFetch("/api/cats");
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
    expect(new Headers(init.headers).get("x-client-id")).toBe("phone-1");
  });

  it("refreshes first when the access token is stale, and once more on a 401, then gives up", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const auth = fakeAuth([null, "fresh", "fresh"], { ok: true });
    const apiFetch = createApiFetch({ fetchFn: fetchFn as unknown as typeof fetch, auth, clientId: "c" });
    const res = await apiFetch("/api/cats");
    expect(res.status).toBe(200);
    expect(auth.refresh).toHaveBeenCalledTimes(2);
  });

  it("throws ApiError with the status and body on a non-2xx that is not a 401", async () => {
    const fetchFn = vi.fn(async () => new Response('{"error":"name taken"}', { status: 409 }));
    const apiFetch = createApiFetch({ fetchFn: fetchFn as unknown as typeof fetch, auth: fakeAuth(["t"], { ok: true }), clientId: "c" });
    await expect(apiFetch("/api/house", { method: "PATCH" })).rejects.toMatchObject({ status: 409, body: { error: "name taken" } });
  });

  it("a 401 after a rejected refresh throws ApiError(401) and does not loop", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 401 }));
    const auth = fakeAuth(["t", "t"], { ok: false, reason: "rejected" });
    const apiFetch = createApiFetch({ fetchFn: fetchFn as unknown as typeof fetch, auth, clientId: "c" });
    await expect(apiFetch("/api/cats")).rejects.toBeInstanceOf(ApiError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
