import { test, expect, type Page } from "@playwright/test";

async function openConsole(page: Page) {
  await page.goto("/login");
  await expect(page.getByTestId("login")).toBeVisible();
  // One triple-click: three separate awaited clicks can exceed the 600 ms multi-tap window on a slow runner.
  await page.getByRole("heading", { name: "feedme2" }).click({ clickCount: 3 });
  return page.getByTestId("hidden-console");
}

test("3 taps on the logo open the hidden console", async ({ page }) => {
  await expect(await openConsole(page)).toBeVisible();
});

test("fewer than 3 taps keep the console hidden", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login")).toBeVisible();
  await page.getByRole("heading", { name: "feedme2" }).click({ clickCount: 2 });
  await expect(page.getByTestId("hidden-console")).toHaveCount(0);
});

test("console shows every tier version, never blank", async ({ page }) => {
  const panel = await openConsole(page);
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("version-client")).toContainText(/\d+\.\d+\.\d+/);
  // The worker tiers resolve asynchronously: an explicit marker ("unreachable", "none applied") is allowed, an empty row is not.
  for (const tier of ["worker", "schema", "firmware", "env"]) {
    await expect(page.getByTestId(`version-${tier}`)).toHaveText(/\S/);
  }
});

test("console shows the client startup line and says the house feed is skipped when signed out", async ({ page }) => {
  await openConsole(page);
  await expect(page.getByTestId("console-feed")).toContainText("app started");
  await expect(page.getByTestId("log-entry").first()).toBeVisible();
  await expect(page.getByTestId("server-feed-unavailable")).toBeVisible();
});

test("the source filters narrow the feed to this phone's web lines", async ({ page }) => {
  await openConsole(page);
  await expect(page.getByTestId("console-filters")).toBeVisible();
  await page.getByTestId("filter-web").click();
  await expect(page.getByTestId("console-feed")).toContainText("app started");
  await page.getByTestId("filter-device").click();
  await expect(page.getByTestId("log-entry")).toHaveCount(0);
  await expect(page.getByTestId("console-feed")).toContainText("Nothing matches.");
});

test("console closes via its close button", async ({ page }) => {
  const panel = await openConsole(page);
  await expect(panel).toBeVisible();
  await page.getByTestId("console-close").click();
  await expect(panel).toHaveCount(0);
});

test("Escape closes the console", async ({ page }) => {
  const panel = await openConsole(page);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});
