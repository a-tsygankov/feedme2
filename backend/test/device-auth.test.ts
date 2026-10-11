import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { pairDevice } from "./helpers/device.ts";
import { signDeviceToken } from "../src/auth/device-tokens.ts";

describe("requireDevice", () => {
  beforeAll(applyAllMigrations);
  it("accepts a paired device and refreshes last_seen_at at most once a minute", async () => {
    const d = await pairDevice();
    const r1 = await d.fetchDevice("/api/device/state");
    expect(r1.status).toBe(200);
    const seen1 = (await env.DB.prepare("SELECT last_seen_at FROM devices WHERE id = ?").bind(d.deviceId).first<{ last_seen_at: number }>())!.last_seen_at;
    await d.fetchDevice("/api/device/state");
    const seen2 = (await env.DB.prepare("SELECT last_seen_at FROM devices WHERE id = ?").bind(d.deviceId).first<{ last_seen_at: number }>())!.last_seen_at;
    expect(seen2).toBe(seen1);
  });
  it("rejects a house token, an unknown device and a revoked device", async () => {
    const d = await pairDevice();
    expect((await d.house.fetchAuthed("/api/device/state")).status).toBe(401);
    const ghost = await signDeviceToken(d.house.houseId, "f".repeat(32), env.AUTH_SECRET);
    expect((await SELF.fetch("http://feedme2/api/device/state", { headers: { authorization: `Bearer ${ghost}` } })).status).toBe(401);
    expect((await d.house.fetchAuthed(`/api/devices/${d.deviceId}`, { method: "DELETE" })).status).toBe(204);
    expect((await d.fetchDevice("/api/device/state")).status).toBe(401);
  });
});
