import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { requireTestAuth, signInAsTestHouse, uniqueHouseName } from "./helpers/test-auth.ts";
import { seedReportMonth } from "./helpers/seed.ts";
import { addCat } from "./helpers/ui.ts";
import { SEED_FROM, SEED_TO } from "../../shared/src/testing/seed-month.ts";

/**
 * The Phase 4 exit test (spec §7: "e2e over a seeded month"). The month holds Berlin's spring-forward day, and the
 * browser sits in Tokyo (UTC+9, no DST) while the house is in Europe/Berlin: a bucket, bound or label computed in
 * the browser's zone instead of the house's lands on the wrong day or hour and fails here (Review Focus 1 and 2).
 */
test.use({ timezoneId: "Asia/Tokyo" });

test("a seeded month reports, drills down to a DST day and exports", async ({ page }) => {
  await requireTestAuth(page);
  const session = await signInAsTestHouse(page, uniqueHouseName("reports"));
  await seedReportMonth(page, session.accessToken);

  await page.getByTestId("tab-reports").click();
  await expect(page.getByTestId("reports")).toBeVisible();
  await page.goto(`/reports?range=month&from=${SEED_FROM}`);
  await expect(page.getByTestId("tile-feedings")).toHaveText(/154/);
  // Luna's 13:00 on the 15th to 07:00 on the 16th.
  await expect(page.getByTestId("tile-longest-gap")).toHaveText(/18 h/);
  await expect(page.getByTestId("report-cat")).toBeVisible(); // two cats, so the filter shows

  // month → week → day: the 23-hour day still lists its five feedings at Berlin wall times.
  await page.getByTestId("report-drill").getByRole("button", { name: /^23 – 29 Mar/ }).click();
  await expect(page).toHaveURL(/range=week&from=2026-03-23/);
  await page.getByTestId("report-drill").getByRole("button", { name: /^Sun 29 Mar/ }).click();
  await expect(page).toHaveURL(/range=day&from=2026-03-29/);
  await expect(page.getByTestId("day-feeding")).toHaveCount(5);
  const times = await page.getByTestId("day-feeding").locator("time").allTextContents();
  expect(times).toEqual(["07:00", "07:30", "13:00", "19:00", "20:00"]);

  // Back walks up the drill-down.
  await page.goBack();
  await expect(page).toHaveURL(/range=week&from=2026-03-23/);
  await expect(page.getByTestId("report-drill").getByRole("button", { name: /^Sun 29 Mar/ })).toBeVisible();

  // The gap day: Luna's 20:00 is missing.
  await page.goto(`/reports?range=day&from=2026-03-15`);
  await expect(page.getByTestId("day-feeding")).toHaveCount(4);

  // CSV for the month: header + 154 rows, BOM stripped.
  await page.goto(`/reports?range=month&from=${SEED_FROM}`);
  await expect(page.getByTestId("tile-feedings")).toHaveText(/154/);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("report-csv").click()]);
  expect(download.suggestedFilename()).toBe(`feedme2-${SEED_FROM}-${SEED_TO}.csv`);
  const text = (await readFile(await download.path(), "utf8")).replace(/^﻿/, "");
  const lines = text.trimEnd().split("\r\n");
  expect(lines[0]).toBe("date,time,cat,amount,unit,grams,entered_value,entered_unit,source,note");
  expect(lines).toHaveLength(155);
});

test("a cat page shows its last 30 days and opens them in Reports", async ({ page }) => {
  await requireTestAuth(page);
  const session = await signInAsTestHouse(page, uniqueHouseName("trends"));
  await addCat(page, "Mochi");
  // First feeding of a cat without a default opens the sheet (house-flow.spec.ts does the same).
  await page.getByTestId("cat-feed").click();
  await page.getByTestId("feed-submit").click();
  await expect(page.getByTestId("feed-sheet")).toHaveCount(0);
  const auth = { headers: { authorization: `Bearer ${session.accessToken}` } };
  // The outbox syncs in the background; the report reads the server.
  await expect
    .poll(async () => ((await (await page.request.get("/api/feedings", auth)).json()) as { items: unknown[] }).items.length)
    .toBe(1);
  const cats = ((await (await page.request.get("/api/cats", auth)).json()) as { cats: Array<{ id: string }> }).cats;
  const catId = cats[0]!.id;

  await page.goto(`/cats/${catId}`);
  const trends = page.getByTestId("cat-trends");
  await expect(trends).toBeVisible();
  await expect(trends.getByTestId("trend-feedings")).toHaveText(/1$/);
  await expect(trends.getByText("No feedings in this range")).toHaveCount(0);
  const link = trends.getByTestId("cat-trends-link");
  await expect(link).toHaveAttribute("href", new RegExp(`range=custom.*cat=${catId}`));
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/reports\?.*cat=${catId}`));
  // The tile's text is "Feedings" + the value, so the value is matched on its own line.
  await expect(page.getByTestId("tile-feedings").locator("p").nth(1)).toHaveText("1");
});
