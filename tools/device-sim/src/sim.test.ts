import { describe, expect, it } from "vitest";
import sample from "../../../fixtures/device-state.sample.json";
import { DeviceSim, SimError, type SimSnapshot } from "./sim.ts";

/** Minimal in-memory server honouring the device API contract. */
function fakeApi() {
  const calls: Array<{ method: string; path: string; body: unknown; headers: Record<string, string> }> = [];
  let pairings = 0;
  let confirmed = false;
  let etag = 'W/"0000000000000001"';
  let failNext: number | null = null;
  const failOn = new Map<string, number>();
  let checkStatus: "pending" | "expired" | "unknown" = "pending";
  let pollSecret: string | null = null;
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", path: url.pathname, body, headers });
    if (failNext !== null) { const s = failNext; failNext = null; return new Response(JSON.stringify({ error: "internal" }), { status: s }); }
    const json = (b: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...h } });
    if (url.pathname === "/api/pair/start") { pairings++; pollSecret = (body as { pollSecret?: string }).pollSecret ?? null; return json({ pairCode: "123456", expiresAt: Date.now() + 600_000, pollAfterSec: 3 }); }
    // Like the real server: a wrong or missing poll secret is told "pending", never the token.
    if (url.pathname === "/api/pair/check") return confirmed && (body as { pollSecret?: string }).pollSecret === pollSecret ? json({ status: "confirmed", deviceToken: "tok", houseId: "h", houseName: "H", deviceName: "Kitchen" }) : json({ status: checkStatus });
    if (failOn.has(url.pathname)) return json({ error: "boom" }, failOn.get(url.pathname)!);
    if (headers.authorization !== "Bearer tok") return json({ error: "unauthorized" }, 401);
    if (url.pathname === "/api/device/state") {
      if (headers["if-none-match"] === etag) return new Response(null, { status: 304, headers: { etag } });
      return json({ ...sample, now: Date.now() }, 200, { etag });
    }
    if (url.pathname === "/api/device/feedings") return json({ accepted: (body as Array<{ id: string }>).map((i) => i.id), clamped: [], now: Date.now() }, 201);
    if (url.pathname === "/api/device/logs") return new Response(null, { status: 202 });
    if (url.pathname === "/api/device/heartbeat") return json({ now: Date.now() });
    return json({ error: "not_found" }, 404);
  };
  return { fetchFn, calls, confirm: () => { confirmed = true; }, bumpEtag: () => { etag = 'W/"0000000000000002"'; }, failNext: (s: number) => { failNext = s; }, failOn: (path: string, s: number) => { failOn.set(path, s); },
    setCheckStatus: (s: "pending" | "expired" | "unknown") => { checkStatus = s; }, pairings: () => pairings, pollSecret: () => pollSecret };
}

describe("DeviceSim", () => {
  it("pairs by polling until confirmed and keeps the token in its snapshot", async () => {
    const api = fakeApi();
    const sim = new DeviceSim({ apiBase: "http://x", fetchFn: api.fetchFn });
    const start = await sim.pairStart();
    expect(start.pairCode).toBe("123456");
    setTimeout(api.confirm, 20);
    await sim.pairUntilConfirmed({ timeoutMs: 2000, intervalMs: 5 });
    expect(sim.snapshot().token).toBe("tok");
    expect(sim.snapshot().houseId).toBe("h");
    const again = DeviceSim.fromSnapshot({ apiBase: "http://x", fetchFn: api.fetchFn }, sim.snapshot());
    expect(again.deviceId).toBe(sim.deviceId);
  });

  it("refuses to poll without a poll secret, before any request", async () => {
    const api = fakeApi();
    const sim = new DeviceSim({ apiBase: "http://x", fetchFn: api.fetchFn });
    await sim.pairStart();
    const { pollSecret: _gone, ...legacy } = sim.snapshot();
    const old = DeviceSim.fromSnapshot({ apiBase: "http://x", fetchFn: api.fetchFn }, legacy);
    const before = api.calls.length;
    const e1 = await old.pairCheck().catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(SimError);
    expect(e1).toMatchObject({ status: 400, message: "pairing has no poll secret; run pair again" });
    const e2 = await old.pairUntilConfirmed({ timeoutMs: 50, intervalMs: 1 }).catch((e: unknown) => e);
    expect(e2).toMatchObject({ status: 400, message: "pairing has no poll secret; run pair again" });
    expect(api.calls.length).toBe(before);
  });

  it("sends a fresh random poll secret on start and repeats it on every check", async () => {
    const api = fakeApi();
    const sim = new DeviceSim({ apiBase: "http://x", fetchFn: api.fetchFn });
    await sim.pairStart();
    await sim.pairCheck();
    const start = api.calls.find((c) => c.path === "/api/pair/start")!.body as { pollSecret: string };
    const check = api.calls.find((c) => c.path === "/api/pair/check")!.body as { pollSecret: string };
    expect(start.pollSecret).toMatch(/^[0-9a-f]{32}$/);
    expect(check.pollSecret).toBe(start.pollSecret);
    // survives a restart through the snapshot, and a new start rolls it
    const again = DeviceSim.fromSnapshot({ apiBase: "http://x", fetchFn: api.fetchFn }, sim.snapshot());
    await again.pairCheck();
    expect((api.calls.at(-1)!.body as { pollSecret: string }).pollSecret).toBe(start.pollSecret);
    await again.pairStart();
    expect((api.calls.at(-1)!.body as { pollSecret: string }).pollSecret).not.toBe(start.pollSecret);
  });

  it("fetches state with If-None-Match and reports changes", async () => {
    const api = fakeApi();
    const sim = new DeviceSim({ apiBase: "http://x", fetchFn: api.fetchFn });
    await sim.pairStart(); api.confirm(); await sim.pairUntilConfirmed({ timeoutMs: 1000, intervalMs: 1 });
    const a = await sim.fetchState();
    expect(a.changed).toBe(true);
    expect(a.state.cats.map((c) => c.name)).toEqual(["Mochi", "Luna"]);
    const b = await sim.fetchState();
    expect(b.changed).toBe(false);
    expect(api.calls.at(-1)!.headers["if-none-match"]).toBe('W/"0000000000000001"');
    api.bumpEtag();
    expect((await sim.fetchState()).changed).toBe(true);
  });

  it("queues feedings offline, drains them in a sync round and keeps them on a 5xx", async () => {
    const api = fakeApi();
    const sim = new DeviceSim({ apiBase: "http://x", fetchFn: api.fetchFn, now: () => 1_700_003_600_000 });
    await sim.pairStart(); api.confirm(); await sim.pairUntilConfirmed({ timeoutMs: 1000, intervalMs: 1 });
    await sim.fetchState();
    const f = sim.feed("Mochi");
    expect(f).toMatchObject({ amountMg: 40000, enteredUnit: "g", enteredValue: "40", fedAt: 1_700_003_600_000 });
    expect(() => sim.feed("Nobody")).toThrow(/unknown cat/);
    sim.feed("Luna", 51974, { unit: "can", value: "1/3" });
    sim.log("info", "idle cat=Mochi level=content");
    api.failNext(503);
    const bad = await sim.syncRound();
    expect(bad.feedingsAccepted).toBe(0);
    expect(sim.snapshot().queue).toHaveLength(2);
    const ok = await sim.syncRound();
    expect(ok).toMatchObject({ feedingsSent: 2, feedingsAccepted: 2, logsSent: 1, heartbeat: true });
    expect(sim.snapshot().queue).toEqual([]);
    const posted = api.calls.find((c) => c.path === "/api/device/feedings")!.body as Array<{ enteredValue: string }>;
    expect(posted.map((p) => p.enteredValue)).toEqual(["40", "1/3"]);
    const hb = api.calls.find((c) => c.path === "/api/device/heartbeat")!.body as { fwVersion: string; resetReason: string };
    expect(hb).toMatchObject({ fwVersion: "0.2.0", resetReason: "SIM" });
  });

  it("surfaces 401 as SimError so a forgotten device is visible to tests", async () => {
    const api = fakeApi();
    const sim = DeviceSim.fromSnapshot({ apiBase: "http://x", fetchFn: api.fetchFn }, { deviceId: "a".repeat(32), token: "wrong", houseId: "h", etag: null, state: null, queue: [], logs: [] });
    await expect(sim.fetchState()).rejects.toBeInstanceOf(SimError);
  });
  const paired = async (api: ReturnType<typeof fakeApi>, extra: Partial<ConstructorParameters<typeof DeviceSim>[0]> = {}) => {
    const sim = new DeviceSim({ apiBase: "http://x", fetchFn: api.fetchFn, ...extra });
    await sim.pairStart(); api.confirm(); await sim.pairUntilConfirmed({ timeoutMs: 1000, intervalMs: 1 });
    await sim.fetchState();
    return sim;
  };

  it("pairUntilConfirmed gives up with a timeout, and reports an expired or unknown code", async () => {
    const api = fakeApi();
    const sim = new DeviceSim({ apiBase: "http://x", fetchFn: api.fetchFn });
    await sim.pairStart();
    await expect(sim.pairUntilConfirmed({ timeoutMs: 30, intervalMs: 5 })).rejects.toMatchObject({ name: "SimError", status: 408 });
    api.setCheckStatus("expired");
    await expect(sim.pairUntilConfirmed({ timeoutMs: 1000, intervalMs: 1 })).rejects.toMatchObject({ status: 410, message: "pairing expired" });
    api.setCheckStatus("unknown");
    await expect(sim.pairUntilConfirmed({ timeoutMs: 1000, intervalMs: 1 })).rejects.toMatchObject({ status: 410, message: "pairing unknown" });
  });

  it("a 401 in the middle of a sync round is a SimError, with the unsent work kept", async () => {
    const api = fakeApi();
    const sim = await paired(api);
    sim.feed("Mochi");
    sim.log("info", "hello");
    api.failOn("/api/device/logs", 401);
    await expect(sim.syncRound()).rejects.toMatchObject({ name: "SimError", status: 401 });
    expect(sim.snapshot().queue).toEqual([]);
    expect(sim.snapshot().logs).toHaveLength(1);
  });

  it("a non-transient 4xx leaves the item at the head of the queue", async () => {
    const api = fakeApi();
    const sim = await paired(api);
    sim.feed("Mochi");
    api.failOn("/api/device/feedings", 422);
    await expect(sim.syncRound()).rejects.toMatchObject({ status: 422 });
    expect(sim.snapshot().queue).toHaveLength(1);
  });

  it("rejects bad input before it is queued", async () => {
    const api = fakeApi();
    const sim = await paired(api);
    expect(() => sim.feed("Mochi", 0)).toThrow(/amountMg/);
    expect(() => sim.feed("Mochi", 1.5)).toThrow(/amountMg/);
    expect(() => sim.feed("Mochi", 5_000_001)).toThrow(/amountMg/);
    expect(() => sim.feed("Mochi", Number.NaN)).toThrow(/amountMg/);
    expect(() => sim.feed("Mochi", 40_000, { unit: "g", value: "" })).toThrow(/entered value/);
    expect(() => sim.feed("Mochi", 40_000, { unit: "g", value: "   " })).toThrow(/entered value/);
    expect(() => sim.log("loud" as never, "x")).toThrow(/log level/);
    expect(() => sim.log("info", "x".repeat(501))).toThrow(/500/);
    expect(sim.snapshot().queue).toEqual([]);
    expect(sim.snapshot().logs).toEqual([]);
    expect(() => sim.feed("Mochi", 5_000_000)).not.toThrow();
    expect(() => sim.log("info", "x".repeat(500))).not.toThrow();
  });

  it("derives a readable entered value from the amount: whole grams when close, else one decimal", async () => {
    const api = fakeApi();
    const sim = await paired(api);
    expect(sim.feed("Mochi", 51_974).enteredValue).toBe("52");
    expect(sim.feed("Mochi", 51_500).enteredValue).toBe("51.5");
    expect(sim.feed("Mochi", 800).enteredValue).toBe("0.8");
  });

  // Regression: 1-50 mg used to snap to the whole gram "0", which the server's EnteredValueSchema refuses,
  // so feed(cat, 24) threw even though 24 mg is a valid amount.
  it("derives a positive entered value for tiny amounts instead of snapping to 0", async () => {
    const api = fakeApi();
    const sim = await paired(api);
    expect(sim.feed("Mochi", 24).enteredValue).toBe("0.02");
    expect(sim.feed("Mochi", 1).enteredValue).toBe("0.001");
    expect(sim.feed("Mochi", 49).enteredValue).toBe("0.05");
    expect(sim.feed("Mochi", 960).enteredValue).toBe("1");
  });

  it("heartbeat reports the configured battery level", async () => {
    const api = fakeApi();
    const sim = await paired(api, { batteryPct: 0 });
    await sim.heartbeat();
    expect(api.calls.at(-1)!.body).toMatchObject({ batteryPct: 0 });
    const api2 = fakeApi();
    const bare = await paired(api2);
    await bare.heartbeat();
    expect(api2.calls.at(-1)!.body).not.toHaveProperty("batteryPct");
  });

  it("keeps logs that arrive during an upload, even when the buffer trims the uploaded ones", async () => {
    const api = fakeApi();
    let sim!: DeviceSim;
    const sent: string[] = [];
    let injected = false;
    const fetchFn: typeof fetch = async (input, init) => {
      if (new URL(String(input)).pathname === "/api/device/logs") {
        for (const e of JSON.parse(String(init!.body)) as Array<{ msg: string }>) sent.push(e.msg);
        if (!injected) { injected = true; for (let i = 0; i < 500; i++) sim.log("info", `late ${i}`); }
        return new Response(null, { status: 202 });
      }
      return api.fetchFn(input, init);
    };
    sim = await paired(api, { fetchFn });
    for (let i = 0; i < 50; i++) sim.log("info", `early ${i}`);
    await sim.syncRound();
    expect(sent.filter((m) => m.startsWith("late"))).toHaveLength(500);
    expect(sim.snapshot().logs).toEqual([]);
  });

  it("persists the api base in its snapshot", () => {
    const sim = new DeviceSim({ apiBase: "http://x/" });
    expect(sim.snapshot().apiBase).toBe("http://x");
    const snap: SimSnapshot = { ...sim.snapshot() };
    expect(DeviceSim.fromSnapshot({ apiBase: "http://y" }, snap).snapshot().apiBase).toBe("http://y");
  });
});
