import { SELF, env } from "cloudflare:test";
import { DeviceSchema, PairCheckResponseSchema, PairStartResponseSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";
import { newDeviceId } from "./helpers/device.ts";
import { clock } from "../src/auth/tokens.ts";
import { PAIR_TTL_MS } from "../src/repos/pairings.ts";

const post = (path: string, body: unknown, auth?: string) =>
  SELF.fetch(`http://feedme2${path}`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });

describe("/api/pair", () => {
  beforeAll(applyAllMigrations);

  it("start → pending → confirm → confirmed with a token the device can use", async () => {
    const s = await signup();
    const deviceId = newDeviceId();
    const start = PairStartResponseSchema.parse(await (await post("/api/pair/start", { deviceId, hwModel: "device-sim", fwVersion: "0.2.0" })).json());
    expect(start.pairCode).toMatch(/^\d{6}$/);
    expect(start.pollAfterSec).toBe(3);
    expect(PairCheckResponseSchema.parse(await (await post("/api/pair/check", { deviceId })).json())).toEqual({ status: "pending" });
    const confirm = await s.fetchAuthed("/api/pair/confirm", { method: "POST", body: JSON.stringify({ pairCode: start.pairCode, name: "Kitchen" }) });
    expect(confirm.status).toBe(201);
    const device = DeviceSchema.parse(((await confirm.json()) as { device: unknown }).device);
    expect(device).toMatchObject({ id: deviceId, houseId: s.houseId, name: "Kitchen", hwModel: "device-sim", fwVersion: "0.2.0", revokedAt: null });
    const check = PairCheckResponseSchema.parse(await (await post("/api/pair/check", { deviceId })).json());
    expect(check.status).toBe("confirmed");
    if (check.status !== "confirmed") return;
    expect(check.houseId).toBe(s.houseId);
    expect(check.deviceName).toBe("Kitchen");
    const state = await SELF.fetch("http://feedme2/api/device/state", { headers: { authorization: `Bearer ${check.deviceToken}` } });
    expect(state.status).toBe(200);
  });

  it("a second start replaces the code; the old code no longer confirms", async () => {
    const s = await signup();
    const deviceId = newDeviceId();
    const a = PairStartResponseSchema.parse(await (await post("/api/pair/start", { deviceId, hwModel: "device-sim", fwVersion: "0.2.0" })).json());
    const b = PairStartResponseSchema.parse(await (await post("/api/pair/start", { deviceId, hwModel: "device-sim", fwVersion: "0.2.0" })).json());
    expect(b.pairCode).not.toBe(a.pairCode);
    expect((await s.fetchAuthed("/api/pair/confirm", { method: "POST", body: JSON.stringify({ pairCode: a.pairCode }) })).status).toBe(404);
    expect((await s.fetchAuthed("/api/pair/confirm", { method: "POST", body: JSON.stringify({ pairCode: b.pairCode }) })).status).toBe(201);
  });

  it("a used code answers 409 and an expired one 404; check reports expired", async () => {
    const s = await signup();
    const deviceId = newDeviceId();
    const start = PairStartResponseSchema.parse(await (await post("/api/pair/start", { deviceId, hwModel: "device-sim", fwVersion: "0.2.0" })).json());
    expect((await s.fetchAuthed("/api/pair/confirm", { method: "POST", body: JSON.stringify({ pairCode: start.pairCode }) })).status).toBe(201);
    const again = await s.fetchAuthed("/api/pair/confirm", { method: "POST", body: JSON.stringify({ pairCode: start.pairCode }) });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "pair_code_used" });
    const other = newDeviceId();
    const st2 = PairStartResponseSchema.parse(await (await post("/api/pair/start", { deviceId: other, hwModel: "device-sim", fwVersion: "0.2.0" })).json());
    const spy = vi.spyOn(clock, "now").mockReturnValue(Date.now() + PAIR_TTL_MS + 1000);
    try {
      expect((await s.fetchAuthed("/api/pair/confirm", { method: "POST", body: JSON.stringify({ pairCode: st2.pairCode }) })).status).toBe(404);
      expect(PairCheckResponseSchema.parse(await (await post("/api/pair/check", { deviceId: other })).json())).toEqual({ status: "expired" });
    } finally {
      spy.mockRestore();
    }
    expect(PairCheckResponseSchema.parse(await (await post("/api/pair/check", { deviceId: newDeviceId() })).json())).toEqual({ status: "unknown" });
  });

  it("re-pairing a device that is live in another house is refused until it is forgotten", async () => {
    const a = await signup();
    const b = await signup();
    const deviceId = newDeviceId();
    const s1 = PairStartResponseSchema.parse(await (await post("/api/pair/start", { deviceId, hwModel: "device-sim", fwVersion: "0.2.0" })).json());
    expect((await a.fetchAuthed("/api/pair/confirm", { method: "POST", body: JSON.stringify({ pairCode: s1.pairCode }) })).status).toBe(201);
    const s2 = PairStartResponseSchema.parse(await (await post("/api/pair/start", { deviceId, hwModel: "device-sim", fwVersion: "0.2.1" })).json());
    const refused = await b.fetchAuthed("/api/pair/confirm", { method: "POST", body: JSON.stringify({ pairCode: s2.pairCode }) });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "device_in_use" });
    expect((await a.fetchAuthed(`/api/devices/${deviceId}`, { method: "DELETE" })).status).toBe(204);
    const s3 = PairStartResponseSchema.parse(await (await post("/api/pair/start", { deviceId, hwModel: "device-sim", fwVersion: "0.2.1" })).json());
    expect((await b.fetchAuthed("/api/pair/confirm", { method: "POST", body: JSON.stringify({ pairCode: s3.pairCode }) })).status).toBe(201);
    const row = await env.DB.prepare("SELECT house_id, revoked_at, fw_version FROM devices WHERE id = ?").bind(deviceId).first<{ house_id: string; revoked_at: number | null; fw_version: string }>();
    expect(row).toMatchObject({ house_id: b.houseId, revoked_at: null, fw_version: "0.2.1" });
  });

  it("validates bodies with the standard 400 shape", async () => {
    const r = await post("/api/pair/start", { deviceId: "nope", hwModel: "device-sim", fwVersion: "0.2.0" });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "invalid_request" });
  });
});
