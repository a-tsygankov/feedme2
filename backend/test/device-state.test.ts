import { DeviceStateSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { clock } from "../src/auth/tokens.ts";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { pairDevice } from "./helpers/device.ts";

describe("GET /api/device/state", () => {
  beforeAll(applyAllMigrations);

  it("carries settings, offset, cats with defaults, device name and server time", async () => {
    const d = await pairDevice(undefined, "Kitchen");
    await d.house.fetchAuthed("/api/house", { method: "PATCH", body: JSON.stringify({ timezone: "Asia/Kolkata", foodUnit: "oz" }) });
    const cat = crypto.randomUUID();
    await d.house.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: cat, name: "Mochi" }) });
    await d.house.fetchAuthed("/api/feedings", { method: "POST", body: JSON.stringify([{ id: crypto.randomUUID(), catId: cat, fedAt: Date.now() - 1000, amountMg: 42524, enteredUnit: "oz", enteredValue: "1.5" }]) });
    const r = await d.fetchDevice("/api/device/state");
    expect(r.status).toBe(200);
    expect(r.headers.get("etag")).toMatch(/^W\/"[0-9a-f]{16}"$/);
    const s = DeviceStateSchema.parse(await r.json());
    expect(s.house.settings.foodUnit).toBe("oz");
    expect(s.house.tzOffsetMin).toBe(330);
    expect(s.device).toEqual({ id: d.deviceId, name: "Kitchen" });
    expect(s.cats).toHaveLength(1);
    expect(s.cats[0]).toMatchObject({ id: cat, name: "Mochi", defaultAmountMg: 42524, defaultEnteredUnit: "oz", defaultEnteredValue: "1.5" });
    expect(s.cats[0]!.lastFedAt).toBeGreaterThan(0);
    expect(Math.abs(s.now - Date.now())).toBeLessThan(5000);
    expect(s.syncIntervalSec).toBe(s.house.settings.syncIntervalSec);
  });

  // Attack surface: the device pins its clock offset from this response and 304s keep it; a tag that ignored
  // the offset left a New York device an hour off after the clocks changed, until something else changed.
  it("the tag changes when the house timezone offset does (DST), and the body carries the new offset", async () => {
    const d = await pairDevice();
    await d.house.fetchAuthed("/api/house", { method: "PATCH", body: JSON.stringify({ timezone: "America/New_York" }) });
    const spy = vi.spyOn(clock, "now");
    try {
      spy.mockReturnValue(Date.parse("2026-11-01T05:30:00Z")); // 01:30 EDT, still summer time
      const before = await d.fetchDevice("/api/device/state");
      const beforeBody = DeviceStateSchema.parse(await before.json());
      spy.mockReturnValue(Date.parse("2026-11-01T06:30:00Z")); // 01:30 EST, the clocks went back at 06:00Z
      const after = await d.fetchDevice("/api/device/state", { headers: { "if-none-match": before.headers.get("etag")! } });
      expect(after.status).toBe(200);
      const afterBody = DeviceStateSchema.parse(await after.json());
      expect(beforeBody.house.tzOffsetMin).toBe(-240);
      expect(afterBody.house.tzOffsetMin).toBe(-300);
      expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));
      // ...but plain time passing with the same offset still 304s.
      spy.mockReturnValue(Date.parse("2026-11-01T07:30:00Z"));
      expect((await d.fetchDevice("/api/device/state", { headers: { "if-none-match": after.headers.get("etag")! } })).status).toBe(304);
    } finally {
      spy.mockRestore();
    }
  });

  it("304s on a matching If-None-Match; the tag survives time passing but not a rename, a feeding or a setting", async () => {
    const d = await pairDevice();
    const cat = crypto.randomUUID();
    await d.house.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: cat, name: "Mochi" }) });
    const r1 = await d.fetchDevice("/api/device/state");
    const tag = r1.headers.get("etag")!;
    const r2 = await d.fetchDevice("/api/device/state", { headers: { "if-none-match": tag } });
    expect(r2.status).toBe(304);
    expect(await r2.text()).toBe("");
    await d.house.fetchAuthed(`/api/cats/${cat}`, { method: "PATCH", body: JSON.stringify({ name: "Mochi II" }) });
    const r3 = await d.fetchDevice("/api/device/state", { headers: { "if-none-match": tag } });
    expect(r3.status).toBe(200);
    const tag3 = r3.headers.get("etag")!;
    expect(tag3).not.toBe(tag);
    await d.house.fetchAuthed("/api/feedings", { method: "POST", body: JSON.stringify([{ id: crypto.randomUUID(), catId: cat, fedAt: Date.now(), amountMg: 40000, enteredUnit: "g", enteredValue: "40" }]) });
    expect((await d.fetchDevice("/api/device/state", { headers: { "if-none-match": tag3 } })).status).toBe(200);
    const r5 = await d.fetchDevice("/api/device/state");
    const tag5 = r5.headers.get("etag")!;
    await d.house.fetchAuthed("/api/house", { method: "PATCH", body: JSON.stringify({ gramStep: 10 }) });
    expect((await d.fetchDevice("/api/device/state", { headers: { "if-none-match": tag5 } })).status).toBe(200);
    // a deleted cat disappears and changes the tag
    const r7 = await d.fetchDevice("/api/device/state");
    await d.house.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), name: "Luna" }) });
    await d.house.fetchAuthed(`/api/cats/${cat}`, { method: "DELETE" });
    const r8 = await d.fetchDevice("/api/device/state", { headers: { "if-none-match": r7.headers.get("etag")! } });
    expect(r8.status).toBe(200);
    expect(DeviceStateSchema.parse(await r8.json()).cats.map((c) => c.name)).toEqual(["Luna"]);
  });
});
