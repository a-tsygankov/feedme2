import { HouseSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";

describe("/api/house", () => {
  beforeAll(applyAllMigrations);

  it("reads and patches settings, keeping unpatched fields", async () => {
    const s = await signup();
    const patch = await s.fetchAuthed("/api/house", { method: "PATCH", body: JSON.stringify({ foodUnit: "can", canFractionStep: "1/3" }) });
    expect(patch.status).toBe(200);
    const house = HouseSchema.parse(((await patch.json()) as { house: unknown }).house);
    expect(house.settings.foodUnit).toBe("can");
    expect(house.settings.canFractionStep).toBe("1/3");
    expect(house.settings.gramStep).toBe(5);
    const get = await s.fetchAuthed("/api/house");
    expect(HouseSchema.parse(((await get.json()) as { house: unknown }).house).settings.foodUnit).toBe("can");
  });

  it("rejects unknown keys and out-of-range values with 400", async () => {
    const s = await signup();
    expect((await s.fetchAuthed("/api/house", { method: "PATCH", body: JSON.stringify({ bogus: 1 }) })).status).toBe(400);
    expect((await s.fetchAuthed("/api/house", { method: "PATCH", body: JSON.stringify({ sleepTimeoutSec: 10 }) })).status).toBe(400);
  });

  it("renaming to another house's name is a 409", async () => {
    const a = await signup("Alpha Flat");
    const b = await signup("Beta Flat");
    const r = await b.fetchAuthed("/api/house", { method: "PATCH", body: JSON.stringify({ name: "alpha flat" }) });
    expect(r.status).toBe(409);
    expect(a.house.name).toBe("Alpha Flat");
  });
});
