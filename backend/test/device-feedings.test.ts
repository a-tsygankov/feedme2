import { DeviceFeedingsResponseSchema, FeedingsPageSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { pairDevice } from "./helpers/device.ts";

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

  it("clamps a bad device clock instead of rejecting (1970 and far future both land near now)", async () => {
    const d = await pairDevice();
    const cat = crypto.randomUUID();
    await d.house.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: cat, name: "Mochi" }) });
    const old = crypto.randomUUID();
    const future = crypto.randomUUID();
    const r = await d.fetchDevice("/api/device/feedings", {
      method: "POST",
      body: JSON.stringify([
        { id: old, catId: cat, fedAt: 1, amountMg: 40000, enteredUnit: "g", enteredValue: "40" },
        { id: future, catId: cat, fedAt: Date.now() + 2 * DAY, amountMg: 40000, enteredUnit: "g", enteredValue: "40" },
      ]),
    });
    expect(r.status).toBe(201);
    const a = DeviceFeedingsResponseSchema.parse(await r.json());
    expect(a.accepted.sort()).toEqual([old, future].sort());
    expect(a.clamped.sort()).toEqual([old, future].sort());
    const page = FeedingsPageSchema.parse(await (await d.house.fetchAuthed("/api/feedings")).json());
    for (const f of page.items) expect(Math.abs(f.fedAt - Date.now())).toBeLessThan(8 * DAY);
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
