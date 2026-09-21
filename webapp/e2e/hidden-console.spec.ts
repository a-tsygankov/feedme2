import { test, expect, type Page } from "@playwright/test";

async function openConsole(page: Page) {
  const logo = page.getByRole("heading", { name: "feedme2" });
  await logo.click();
  await logo.click();
  await logo.click();
  return page.getByTestId("hidden-console");
}

test("3 taps on the logo open the hidden console", async ({ page }) => {
  await page.goto("/");
  await expect(await openConsole(page)).toBeVisible();
});

test("fewer than 3 taps keep the console hidden", async ({ page }) => {
  await page.goto("/");
  const logo = page.getByRole("heading", { name: "feedme2" });
  await logo.click();
  await logo.click();
  await expect(page.getByTestId("hidden-console")).toHaveCount(0);
});

test("console shows every tier version, never blank", async ({ page }) => {
  await page.goto("/");
  await openConsole(page);
  await expect(page.getByTestId("version-client")).toContainText(/\d+\.\d+\.\d+/);
  await expect(page.getByTestId("version-worker")).not.toBeEmpty();
  await expect(page.getByTestId("version-schema")).not.toBeEmpty();
  await expect(page.getByTestId("version-firmware")).not.toBeEmpty();
});

test("console shows the client startup line and the worker feed", async ({ page }) => {
  await page.goto("/");
  await openConsole(page);
  await expect(page.getByTestId("client-logs")).toContainText("app started");
  await expect(page.getByTestId("worker-logs")).toBeVisible();
});

test("console closes via its close button", async ({ page }) => {
  await page.goto("/");
  const panel = await openConsole(page);
  await page.getByTestId("console-close").click();
  await expect(panel).toHaveCount(0);
});
