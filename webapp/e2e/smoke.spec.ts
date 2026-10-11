import { test, expect, type Page } from "@playwright/test";

/**
 * A false "update available" trains people to dismiss the bar, so the real one gets dismissed too. The negative
 * assertion is only meaningful once the service worker had its chance to run, so wait for it rather than a clock.
 */
async function settleServiceWorker(page: Page) {
  await page.evaluate(() =>
    "serviceWorker" in navigator
      ? Promise.race([
          navigator.serviceWorker.ready.then(() => "ready"),
          new Promise((r) => setTimeout(() => r("timeout"), 5000)),
        ])
      : "unsupported",
  );
  await page.waitForTimeout(500);
}

test("the login screen loads with the wordmark and a way to create a house", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveTitle(/feedme2/);
  await expect(page.getByRole("heading", { name: "feedme2" })).toBeVisible();
  await expect(page.getByTestId("login")).toBeVisible();
  await expect(page.getByTestId("login-to-setup")).toBeVisible();
});

test("the sign-in link leads to the setup form", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-to-setup").click();
  await expect(page.getByTestId("setup")).toBeVisible();
});

test("client-routed URLs are served by the SPA fallback", async ({ page }) => {
  await page.goto("/setup");
  await expect(page.getByTestId("setup")).toBeVisible();
});

test("a signed-out visit to the dashboard is sent to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("login")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("no update bar on an ordinary load, nor after a reload", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login")).toBeVisible();
  await settleServiceWorker(page);
  await expect(page.getByTestId("update-bar")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("login")).toBeVisible();
  await settleServiceWorker(page);
  await expect(page.getByTestId("update-bar")).toHaveCount(0);
});
