import { DeviceFeedingsResponseSchema, FeedingsPageSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { pairDevice } from "./helpers/device.ts";
import { clampFedAt, FED_AT_MAX_FUTURE_MS, FED_AT_UNSET_BEFORE_MS } from "../src/repos/feedings.ts";

const DAY = 86_400_000;

describe("POST /api/device/feedings", () => {
  beforeAll(applyAllMigrations);

  it("records device feedings idempotently and updates the cat's defaults", async () => {
    const d = await pairDevice();
    const cat = crypto.randomUUID();
    await d.house.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: cat, name: "Mochi" }) });
    const id = crypto.randomUUID();
    const body = [{ id, catId: cat, fedAt: Date.now() - 500, amountMg: 51974, enteredUnit: "can", enteredValue: "1/3" }];
    const r1 = await d.fetchDevice("/api/device/feedings", { method: "POST", body: JSON.stringify(body) });
    expect(r1.status).toBe(201);
    const a = DeviceFeedingsResponseSchema.parse(await r1.json());
    expect(a.accepted).toEqual([id]);
    expect(a.clamped).toEqual([]);
    const r2 = await d.fetchDevice("/api/device/feedings", { method: "POST", body: JSON.stringify(body) });
    expect(DeviceFeedingsResponseSchema.parse(await r2.json()).accepted).toEqual([]);
    const page = FeedingsPageSchema.parse(await (await d.house.fetchAuthed("/api/feedings")).json());
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ source: "device", deviceId: d.deviceId, amountMg: 51974 });
    const cats = (await (await d.house.fetchAuthed("/api/cats")).json()) as { cats: Array<{ defaultEnteredValue: string | null }> };
    expect(cats.cats[0]!.defaultEnteredValue).toBe("1/3");
  });

  it("clamps an unset or runaway device clock to now but keeps a real backlog (1970 and far future clamp, 30 days ago stays)", async () => {
    const d = await pairDevice();
    const cat = crypto.randomUUID();
    await d.house.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: cat, name: "Mochi" }) });
    const old = crypto.randomUUID();
    const future = crypto.randomUUID();
    const backlog = crypto.randomUUID();
    const t0 = Date.now();
    const r = await d.fetchDevice("/api/device/feedings", {
      method: "POST",
      body: JSON.stringify([
        { id: old, catId: cat, fedAt: 1, amountMg: 40000, enteredUnit: "g", enteredValue: "40" },
        { id: future, catId: cat, fedAt: Date.now() + 2 * DAY, amountMg: 40000, enteredUnit: "g", enteredValue: "40" },
        { id: backlog, catId: cat, fedAt: t0 - 30 * DAY, amountMg: 40000, enteredUnit: "g", enteredValue: "40" },
      ]),
    });
    expect(r.status).toBe(201);
    const a = DeviceFeedingsResponseSchema.parse(await r.json());
    expect(a.accepted.sort()).toEqual([old, future, backlog].sort());
    expect(a.clamped.sort()).toEqual([old, future].sort());
    const page = FeedingsPageSchema.parse(await (await d.house.fetchAuthed("/api/feedings?limit=10")).json());
    const byId = new Map(page.items.map((f) => [f.id, f.fedAt]));
    expect(Math.abs(byId.get(old)! - Date.now())).toBeLessThan(DAY);
    expect(Math.abs(byId.get(future)! - Date.now())).toBeLessThan(DAY);
    // A device that was offline for a month is not lying about the clock: its feeding keeps its time.
    expect(byId.get(backlog)).toBe(t0 - 30 * DAY);
  });

  it("accepts fedAt 0 (an RTC that never came up) and clamps it to now", async () => {
    const d = await pairDevice();
    const cat = crypto.randomUUID();
    await d.house.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: cat, name: "Mochi" }) });
    const zero = crypto.randomUUID();
    const r = await d.fetchDevice("/api/device/feedings", { method: "POST", body: JSON.stringify([{ id: zero, catId: cat, fedAt: 0, amountMg: 40000, enteredUnit: "g", enteredValue: "40" }]) });
    expect(r.status).toBe(201);
    const a = DeviceFeedingsResponseSchema.parse(await r.json());
    expect(a.accepted).toEqual([zero]);
    expect(a.clamped).toEqual([zero]);
    expect(clampFedAt(0, 1_800_000_000_000)).toEqual({ fedAt: 1_800_000_000_000, clamped: true });
  });

  it("clampFedAt edges: only > now + 5 min and < 2020-01-01 move", () => {
    const now = 1_800_000_000_000;
    expect(clampFedAt(now + FED_AT_MAX_FUTURE_MS, now)).toEqual({ fedAt: now + FED_AT_MAX_FUTURE_MS, clamped: false });
    expect(clampFedAt(now + FED_AT_MAX_FUTURE_MS + 1, now)).toEqual({ fedAt: now, clamped: true });
    expect(clampFedAt(FED_AT_UNSET_BEFORE_MS, now)).toEqual({ fedAt: FED_AT_UNSET_BEFORE_MS, clamped: false });
    expect(clampFedAt(FED_AT_UNSET_BEFORE_MS - 1, now)).toEqual({ fedAt: now, clamped: true });
    expect(clampFedAt(1, now)).toEqual({ fedAt: now, clamped: true });
    expect(clampFedAt(now - 365 * DAY, now)).toEqual({ fedAt: now - 365 * DAY, clamped: false });
    expect(FED_AT_UNSET_BEFORE_MS).toBe(Date.UTC(2020, 0, 1));
  });

  it("refuses a request body over 64 KB before parsing it", async () => {
    const d = await pairDevice();
    const r = await d.fetchDevice("/api/device/feedings", { method: "POST", body: JSON.stringify([{ id: "x".repeat(70_000) }]) });
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ error: "payload_too_large" });
  });

  it("refuses a cat of another house with the ids, and rejects a note", async () => {
    const d = await pairDevice();
    const other = await pairDevice();
    const foreignCat = crypto.randomUUID();
    await other.house.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: foreignCat, name: "Luna" }) });
    const r = await d.fetchDevice("/api/device/feedings", { method: "POST", body: JSON.stringify([{ id: crypto.randomUUID(), catId: foreignCat, fedAt: Date.now(), amountMg: 40000, enteredUnit: "g", enteredValue: "40" }]) });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "cat_not_found", catIds: [foreignCat] });
    const bad = await d.fetchDevice("/api/device/feedings", { method: "POST", body: JSON.stringify([{ id: crypto.randomUUID(), catId: foreignCat, fedAt: Date.now(), amountMg: 40000, enteredUnit: "g", enteredValue: "40", note: "x" }]) });
    expect(bad.status).toBe(400);
  });

  it("answers 409 id_conflict for a feeding id that belongs to another house", async () => {
    const d = await pairDevice();
    const other = await pairDevice();
    const theirCat = crypto.randomUUID();
    await other.house.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: theirCat, name: "Luna" }) });
    const taken = crypto.randomUUID();
    const first = await other.fetchDevice("/api/device/feedings", { method: "POST", body: JSON.stringify([{ id: taken, catId: theirCat, fedAt: Date.now(), amountMg: 40000, enteredUnit: "g", enteredValue: "40" }]) });
    expect(first.status).toBe(201);
    const myCat = crypto.randomUUID();
    await d.house.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: myCat, name: "Mochi" }) });
    const r = await d.fetchDevice("/api/device/feedings", { method: "POST", body: JSON.stringify([{ id: taken, catId: myCat, fedAt: Date.now(), amountMg: 40000, enteredUnit: "g", enteredValue: "40" }]) });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "id_conflict", ids: [taken] });
  });
});
