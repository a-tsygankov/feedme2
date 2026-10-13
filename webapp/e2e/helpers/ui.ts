import { expect, type Page } from "@playwright/test";

/** Opens the Settings tab and waits for it to render. */
export async function openSettings(page: Page): Promise<void> {
  await page.getByTestId("tab-settings").click();
  await expect(page.getByTestId("settings")).toBeVisible();
}

/**
 * The page fits the phone's width. A wider page makes mobile Chrome zoom out, and on CI's Linux runner taps then
 * land on the wrong element (2026-10-12, PR #4: a chart's hidden data table widened /reports to 472 px).
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollW, clientW } = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
  expect(scrollW, `page is ${scrollW}px wide on a ${clientW}px screen`).toBeLessThanOrEqual(clientW);
}

/** Settings → Add a cat → back to the dashboard, where the card must be showing. */
export async function addCat(page: Page, name: string): Promise<void> {
  await openSettings(page);
  await page.getByTestId("cat-add").click();
  await page.getByTestId("cat-name").fill(name);
  await page.getByTestId("cat-save").click();
  await expect(page.getByTestId("cat-row").filter({ hasText: name })).toBeVisible();
  await page.getByTestId("tab-home").click();
  await expect(page.getByTestId("cat-card").filter({ hasText: name })).toBeVisible();
}
