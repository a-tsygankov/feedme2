import { expect, type Page } from "@playwright/test";

/** Opens the Settings tab and waits for it to render. */
export async function openSettings(page: Page): Promise<void> {
  await page.getByTestId("tab-settings").click();
  await expect(page.getByTestId("settings")).toBeVisible();
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
