import { SELF, env } from "cloudflare:test";
import { DevicesResponseSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";
import { pairDevice } from "./helpers/device.ts";
import { signDeviceToken } from "../src/auth/device-tokens.ts";
import { DevicesRepo } from "../src/repos/devices.ts";

const lastSeen = async (id: string) => (await env.DB.prepare("SELECT last_seen_at FROM devices WHERE id = ?").bind(id).first<{ last_seen_at: number }>())!.last_seen_at;
const forget = (h: Awaited<ReturnType<typeof signup>>, id: string) => h.fetchAuthed(`/api/devices/${id}`, { method: "DELETE" });
const sleep = (ms: number) => new Promise((f) => setTimeout(f, ms));

describe("requireDevice", () => {
  beforeAll(applyAllMigrations);
  it("accepts a paired device and refreshes last_seen_at at most once a minute", async () => {
    const d = await pairDevice();
    const r1 = await d.fetchDevice("/api/device/state");
    expect(r1.status).toBe(200);
    const seen1 = await lastSeen(d.deviceId);
    await d.fetchDevice("/api/device/state");
    expect(await lastSeen(d.deviceId)).toBe(seen1);
  });
  it("rejects a house token, an unknown device and a revoked device", async () => {
    const d = await pairDevice();
    expect((await d.house.fetchAuthed("/api/device/state")).status).toBe(401);
    const ghost = await signDeviceToken(d.house.houseId, "f".repeat(32), crypto.randomUUID(), env.AUTH_SECRET);
    expect((await SELF.fetch("http://feedme2/api/device/state", { headers: { authorization: `Bearer ${ghost}` } })).status).toBe(401);
    expect((await forget(d.house, d.deviceId)).status).toBe(204);
    expect((await d.fetchDevice("/api/device/state")).status).toBe(401);
  });

  // Attack: forget then re-pair in the same house revived every old token, because the check was only
  // "same device, same house, not revoked". Each pairing now has its own token id.
  it("forget then re-pair in the same house: the old token is dead, the new one works", async () => {
    const h = await signup();
    const first = await pairDevice(h);
    expect((await forget(h, first.deviceId)).status).toBe(204);
    const second = await pairDevice(h, "Kitchen", first.deviceId);
    expect(second.token).not.toBe(first.token);
    expect((await first.fetchDevice("/api/device/state")).status).toBe(401);
    expect((await second.fetchDevice("/api/device/state")).status).toBe(200);
  });
  it("A pairs, A forgets, B pairs, B forgets, A pairs again: A's first token stays dead", async () => {
    const a = await signup();
    const b = await signup();
    const aFirst = await pairDevice(a);
    await forget(a, aFirst.deviceId);
    const bPaired = await pairDevice(b, "Hall", aFirst.deviceId);
    expect((await aFirst.fetchDevice("/api/device/state")).status).toBe(401);
    await forget(b, aFirst.deviceId);
    const aSecond = await pairDevice(a, "Kitchen", aFirst.deviceId);
    // Same device id and same house as the first pairing: only the token id tells them apart.
    expect((await aFirst.fetchDevice("/api/device/state")).status).toBe(401);
    expect((await bPaired.fetchDevice("/api/device/state")).status).toBe(401);
    expect((await aSecond.fetchDevice("/api/device/state")).status).toBe(200);
  });
  it("a device moved to another house: the previous house's token is 401 and the new one works", async () => {
    const a = await signup();
    const b = await signup();
    const old = await pairDevice(a);
    await forget(a, old.deviceId);
    const moved = await pairDevice(b, "Hall", old.deviceId);
    expect((await old.fetchDevice("/api/device/state")).status).toBe(401);
    expect((await moved.fetchDevice("/api/device/state")).status).toBe(200);
    expect(DevicesResponseSchema.parse(await (await b.fetchAuthed("/api/devices")).json()).devices.map((x) => x.id)).toEqual([old.deviceId]);
    expect(DevicesResponseSchema.parse(await (await a.fetchAuthed("/api/devices")).json()).devices).toEqual([]);
  });
  it("re-confirming while the device is still live in the same house replaces the token", async () => {
    const h = await signup();
    const first = await pairDevice(h);
    const second = await pairDevice(h, "Kitchen", first.deviceId);
    expect((await first.fetchDevice("/api/device/state")).status).toBe(401);
    expect((await second.fetchDevice("/api/device/state")).status).toBe(200);
  });

  // Attack surface: a flaky D1 write for the presence touch must not turn an authenticated call into a 500.
  it("a failing last_seen touch never fails the request", async () => {
    const d = await pairDevice();
    await env.DB.prepare("UPDATE devices SET last_seen_at = 1 WHERE id = ?").bind(d.deviceId).run();
    const spy = vi.spyOn(DevicesRepo.prototype, "touch").mockRejectedValue(new Error("d1 hiccup"));
    try {
      expect((await d.fetchDevice("/api/device/state")).status).toBe(200);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it("leaves the touch of /heartbeat to the handler (one write, with the reported fields)", async () => {
    const d = await pairDevice();
    await env.DB.prepare("UPDATE devices SET last_seen_at = 1 WHERE id = ?").bind(d.deviceId).run();
    const spy = vi.spyOn(DevicesRepo.prototype, "touch");
    try {
      const hb = await d.fetchDevice("/api/device/heartbeat", { method: "POST", body: JSON.stringify({ fwVersion: "0.2.0", uptimeSec: 1, resetReason: "SIM", freeHeap: 1000 }) });
      expect(hb.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("log attribution of device requests", () => {
  beforeAll(applyAllMigrations);
  const rowsSince = async (houseId: string, deviceId: string, since: number) =>
    (await env.DB.prepare("SELECT count(*) AS n FROM log_entries WHERE (house_id = ? OR device_id = ?) AND created_at >= ?").bind(houseId, deviceId, since).first<{ n: number }>())!.n;

  // Attack: attributing by the signature alone let a forgotten device keep writing rows into the house's feed.
  it("a live device's request leaves a row with its device id", async () => {
    const d = await pairDevice();
    expect((await d.fetchDevice("/api/device/state")).status).toBe(200);
    const n = (await env.DB.prepare("SELECT count(*) AS n FROM log_entries WHERE house_id = ? AND device_id = ? AND msg = 'request'").bind(d.house.houseId, d.deviceId).first<{ n: number }>())!.n;
    expect(n).toBeGreaterThan(0);
  });
  it("a revoked device's request leaves no row attributed to its house", async () => {
    const d = await pairDevice();
    await forget(d.house, d.deviceId);
    await sleep(5);
    const t0 = Date.now();
    expect((await d.fetchDevice("/api/device/state")).status).toBe(401);
    expect(await rowsSince(d.house.houseId, d.deviceId, t0)).toBe(0);
  });
  it("a token whose pairing was replaced is not attributed either", async () => {
    const h = await signup();
    const first = await pairDevice(h);
    await forget(h, first.deviceId);
    await pairDevice(h, "Kitchen", first.deviceId);
    await sleep(5);
    const t0 = Date.now();
    expect((await first.fetchDevice("/api/device/state")).status).toBe(401);
    expect(await rowsSince(h.houseId, first.deviceId, t0)).toBe(0);
  });
});
