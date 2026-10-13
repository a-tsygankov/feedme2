import { SELF, env } from "cloudflare:test";
import { DebugLogsResponseSchema, LoginTokenCreateResponseSchema, TokensResponseSchema } from "@feedme2/shared";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clock } from "../src/auth/tokens.ts";
import { runHousekeeping } from "../src/cron.ts";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { json, signup } from "./helpers/api.ts";
import { pairDevice } from "./helpers/device.ts";

const publicPost = (path: string, body: unknown) =>
  SELF.fetch(new Request(`http://feedme2${path}`, { ...json(body), headers: { "content-type": "application/json" } }));

describe("QR login", () => {
  beforeAll(applyAllMigrations);
  afterEach(() => vi.restoreAllMocks());

  async function deviceWithToken() {
    const d = await pairDevice();
    const res = await d.fetchDevice("/api/auth/login-token-create", { method: "POST" });
    expect(res.status).toBe(200);
    return { d, ...LoginTokenCreateResponseSchema.parse(await res.json()) };
  }

  it("signs a phone into the device's house once", async () => {
    const { d, token, expiresInSec } = await deviceWithToken();
    expect(expiresInSec).toBe(60);
    const first = await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token });
    expect(first.status).toBe(200);
    expect(TokensResponseSchema.parse(await first.json()).house.id).toBe(d.house.houseId);
    expect((await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token })).status).toBe(401);
  });

  it("lets exactly one of two simultaneous scans win", async () => {
    const { d, token } = await deviceWithToken();
    const [a, b] = await Promise.all([1, 2].map(() => publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token })));
    expect([a!.status, b!.status].sort()).toEqual([200, 401]);
  });

  it("expires after 60 s", async () => {
    const t0 = Date.now();
    vi.spyOn(clock, "now").mockReturnValue(t0);
    const { d, token } = await deviceWithToken();
    vi.spyOn(clock, "now").mockReturnValue(t0 + 60_001);
    expect((await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token })).status).toBe(401);
  });

  it("is dead once the device is forgotten", async () => {
    const { d, token } = await deviceWithToken();
    expect((await d.house.fetchAuthed(`/api/devices/${d.deviceId}`, { method: "DELETE" })).status).toBe(204);
    expect((await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token })).status).toBe(401);
  });

  // Review fix: a code minted under one pairing must die with it, even when the device is re-paired to the same
  // house inside the minute (the house check alone let it through).
  it("is dead once the device is re-paired, even to the same house", async () => {
    const { d, token } = await deviceWithToken();
    await pairDevice(d.house, "Kitchen again", d.deviceId);
    expect((await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token })).status).toBe(401);
  });

  it("leaves a 'qr login' line in the house's log feed, attributed to the device", async () => {
    const { d, token } = await deviceWithToken();
    expect((await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token })).status).toBe(200);
    const feed = DebugLogsResponseSchema.parse(await (await d.house.fetchAuthed(`/api/debug/logs?source=worker`)).json());
    expect(feed.entries.some((e) => e.msg === "qr login" && e.deviceId === d.deviceId)).toBe(true);
  });

  it("is bound to its device id and replaced by a newer token", async () => {
    const { d, token } = await deviceWithToken();
    const other = await pairDevice();
    expect((await publicPost("/api/auth/login-qr", { deviceId: other.deviceId, token })).status).toBe(401);
    const newer = LoginTokenCreateResponseSchema.parse(await (await d.fetchDevice("/api/auth/login-token-create", { method: "POST" })).json());
    expect((await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token })).status).toBe(401);
    expect((await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token: newer.token })).status).toBe(200);
  });

  it("needs a device token to create, and rejects bad bodies uniformly", async () => {
    const house = await signup();
    expect((await house.fetchAuthed("/api/auth/login-token-create", { method: "POST" })).status).toBe(401);
    expect((await publicPost("/api/auth/login-qr", { deviceId: "x", token: "y" })).status).toBe(400);
    expect((await publicPost("/api/auth/login-qr", { deviceId: "a".repeat(32), token: "A".repeat(43) })).status).toBe(401);
  });

  it("prunes old tokens in the hourly housekeeping", async () => {
    const { d } = await deviceWithToken();
    const count = async () =>
      (await env.DB.prepare("SELECT count(*) AS n FROM login_qr_tokens WHERE device_id = ?").bind(d.deviceId).first<{ n: number }>())?.n;
    expect(await count()).toBe(1);
    // Within the hour after expiry the row is kept (debugging a failed scan).
    await runHousekeeping(env, Date.now() + 30 * 60_000);
    expect(await count()).toBe(1);
    await runHousekeeping(env, Date.now() + 2 * 60 * 60_000);
    expect(await count()).toBe(0);
  });
});
