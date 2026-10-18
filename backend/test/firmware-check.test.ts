import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { pairDevice } from "./helpers/device.ts";

describe("GET /api/device/firmware/check (advisory only)", () => {
  beforeAll(applyAllMigrations);

  it("rejects anonymous requests and malformed current versions", async () => {
    const d = await pairDevice();
    const unauth = await fetch("http://feedme2/api/device/firmware/check?current=0.1.40");
    expect(unauth.status).toBe(401);
    await env.DB.prepare("UPDATE devices SET hw_model = ? WHERE id = ?")
      .bind("xiao-esp32s3-sense-scale", d.deviceId).run();
    expect((await d.fetchDevice("/api/device/firmware/check?current=garbage")).status).toBe(400);
  });

  it("is model-scoped, disabled by default and never advertises installation", async () => {
    const d = await pairDevice();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO firmware_releases (id, hw_model, version, active, created_at) VALUES (?, ?, ?, 0, ?)",
    ).bind(id, "xiao-esp32s3-sense-scale", "0.1.41", Date.now()).run();
    const before = await d.fetchDevice("/api/device/firmware/check?current=0.1.40");
    expect(await before.json()).toEqual({ latest: null, updateAvailable: false, installSupported: false });

    await env.DB.prepare("UPDATE devices SET hw_model = ? WHERE id = ?")
      .bind("xiao-esp32s3-sense-scale", d.deviceId).run();
    const inactive = await d.fetchDevice("/api/device/firmware/check?current=0.1.40");
    expect(await inactive.json()).toEqual({ latest: null, updateAvailable: false, installSupported: false });

    await env.DB.prepare("UPDATE firmware_releases SET active = 1 WHERE id = ?").bind(id).run();
    const newer = await d.fetchDevice("/api/device/firmware/check?current=0.1.40");
    expect(newer.headers.get("cache-control")).toBe("no-store");
    expect(await newer.json()).toEqual({ latest: "0.1.41", updateAvailable: true, installSupported: false });
    expect(await (await d.fetchDevice("/api/device/firmware/check?current=0.1.41")).json())
      .toEqual({ latest: "0.1.41", updateAvailable: false, installSupported: false });
    expect(await (await d.fetchDevice("/api/device/firmware/check?current=0.1.42")).json())
      .toEqual({ latest: "0.1.41", updateAvailable: false, installSupported: false });
  });
});
