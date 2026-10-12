import { expect, type Page } from "@playwright/test";
import { randomSalt, seedMonth, SEED_TZ, type SeedCat } from "../../../shared/src/testing/seed-month.ts";

/** POST /api/feedings takes at most 100 items per batch (the sync outbox's own cap). */
const BATCH = 100;

/**
 * Puts the shared March 2026 fixture into the signed-in house through the public API: the house moves to
 * Europe/Berlin, then both cats, then the 154 feedings. A fresh salt every call, because cat and feeding ids are
 * global primary keys and the local D1 outlives a run (a rerun with the default salt would collide).
 */
export async function seedReportMonth(page: Page, accessToken: string): Promise<{ cats: [SeedCat, SeedCat] }> {
  const headers = { authorization: `Bearer ${accessToken}` };
  const { cats, feedings } = seedMonth(randomSalt());

  const house = await page.request.patch("/api/house", { headers, data: { timezone: SEED_TZ } });
  expect(house.status(), await house.text()).toBe(200);

  for (const cat of cats) {
    const res = await page.request.post("/api/cats", { headers, data: { id: cat.id, name: cat.name, color: cat.color } });
    expect(res.status(), await res.text()).toBe(201);
  }

  for (let i = 0; i < feedings.length; i += BATCH) {
    const data = feedings.slice(i, i + BATCH).map((f) => ({
      id: f.id,
      catId: f.catId,
      fedAt: f.fedAt,
      amountMg: f.amountMg,
      enteredUnit: "g",
      enteredValue: String(f.amountMg / 1000),
    }));
    const res = await page.request.post("/api/feedings", { headers, data });
    expect(res.status(), await res.text()).toBe(201);
  }
  return { cats };
}
