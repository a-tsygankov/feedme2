import { DevicesResponseSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";
import { pairDevice } from "./helpers/device.ts";

describe("/api/devices", () => {
  beforeAll(applyAllMigrations);
  it("lists, renames and toggles auto-install; empty patch is 400", async () => {
    const d = await pairDevice(undefined, "Kitchen");
    const list = DevicesResponseSchema.parse(await (await d.house.fetchAuthed("/api/devices")).json());
    expect(list.devices.map((x) => x.name)).toEqual(["Kitchen"]);
    const patched = await d.house.fetchAuthed(`/api/devices/${d.deviceId}`, { method: "PATCH", body: JSON.stringify({ name: "Hallway", autoInstall: true }) });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { device: { name: string; autoInstall: boolean } }).device).toMatchObject({ name: "Hallway", autoInstall: true });
    expect((await d.house.fetchAuthed(`/api/devices/${d.deviceId}`, { method: "PATCH", body: JSON.stringify({}) })).status).toBe(400);
  });
  it("forget is idempotent, hides the device and is house-scoped", async () => {
    const d = await pairDevice();
    const other = await signup();
    expect((await other.fetchAuthed(`/api/devices/${d.deviceId}`, { method: "DELETE" })).status).toBe(404);
    expect((await other.fetchAuthed(`/api/devices/${d.deviceId}`, { method: "PATCH", body: JSON.stringify({ name: "x" }) })).status).toBe(404);
    expect((await d.house.fetchAuthed(`/api/devices/${d.deviceId}`, { method: "DELETE" })).status).toBe(204);
    expect((await d.house.fetchAuthed(`/api/devices/${d.deviceId}`, { method: "DELETE" })).status).toBe(204);
    expect(DevicesResponseSchema.parse(await (await d.house.fetchAuthed("/api/devices")).json()).devices).toEqual([]);
    expect((await d.house.fetchAuthed(`/api/devices/${d.deviceId}`, { method: "PATCH", body: JSON.stringify({ name: "x" }) })).status).toBe(404);
  });
});
