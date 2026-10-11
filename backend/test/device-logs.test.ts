import { DebugLogsResponseSchema, DevicesResponseSchema, HeartbeatResponseSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { pairDevice } from "./helpers/device.ts";

describe("device heartbeat and logs", () => {
  beforeAll(applyAllMigrations);

  it("heartbeat updates the device row and leaves a worker line attributed to the device", async () => {
    const d = await pairDevice();
    const r = await d.fetchDevice("/api/device/heartbeat", { method: "POST", body: JSON.stringify({ fwVersion: "0.2.3", batteryPct: 87, uptimeSec: 120, resetReason: "POWERON", freeHeap: 150000 }) });
    expect(r.status).toBe(200);
    HeartbeatResponseSchema.parse(await r.json());
    const dev = DevicesResponseSchema.parse(await (await d.house.fetchAuthed("/api/devices")).json()).devices[0]!;
    expect(dev).toMatchObject({ fwVersion: "0.2.3", batteryPct: 87, resetReason: "POWERON" });
    expect(dev.lastSeenAt).toBeGreaterThan(Date.now() - 10_000);
    const feed = DebugLogsResponseSchema.parse(await (await d.house.fetchAuthed(`/api/debug/logs?device=${d.deviceId}&source=worker`)).json());
    expect(feed.entries.some((e) => e.msg === "heartbeat" && e.deviceId === d.deviceId)).toBe(true);
  });

  it("device logs land in the house feed under the device id and are house-scoped", async () => {
    const d = await pairDevice();
    const other = await pairDevice();
    const r = await d.fetchDevice("/api/device/logs", { method: "POST", body: JSON.stringify([{ ts: Date.now(), level: "info", msg: "idle cat=Mochi level=content" }, { ts: Date.now(), level: "error", msg: "wifi lost", data: { rssi: -80 } }]) });
    expect(r.status).toBe(202);
    const mine = DebugLogsResponseSchema.parse(await (await d.house.fetchAuthed(`/api/debug/logs?source=device`)).json());
    expect(mine.entries.map((e) => e.msg)).toEqual(expect.arrayContaining(["idle cat=Mochi level=content", "wifi lost"]));
    expect(mine.entries.every((e) => e.deviceId === d.deviceId)).toBe(true);
    const theirs = DebugLogsResponseSchema.parse(await (await other.house.fetchAuthed(`/api/debug/logs?source=device`)).json());
    expect(theirs.entries).toEqual([]);
    expect((await d.fetchDevice("/api/device/logs", { method: "POST", body: JSON.stringify(Array.from({ length: 51 }, () => ({ ts: 1, level: "info", msg: "x" }))) })).status).toBe(400);
  });
});
