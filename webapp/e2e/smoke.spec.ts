import { test, expect } from "@playwright/test";

test("the login screen loads with the wordmark", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveTitle(/feedme2/);
  await expect(page.getByRole("heading", { name: "feedme2" })).toBeVisible();
  await expect(page.getByTestId("login")).toBeVisible();
});

test("client-routed URLs are served by the SPA fallback", async ({ page }) => {
  await page.goto("/setup");
  await expect(page.getByTestId("setup")).toBeVisible();
});

/**
 * A false "update available" trains people to dismiss the bar, so the
 * real one gets dismissed too. First install must not raise it.
 */
test("no update bar on an ordinary load, nor after a reload", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login")).toBeVisible();
  // Wait for the worker to control the page rather than for a clock: the
  // negative assertion is only meaningful once the first-install branch of
  // offerIfUpdate had its chance to run.
  await page.evaluate(() =>
    "serviceWorker" in navigator
      ? Promise.race([
          navigator.serviceWorker.ready.then(() => "ready"),
          new Promise((r) => setTimeout(() => r("timeout"), 5000)),
        ])
      : "unsupported",
  );
  await page.waitForTimeout(500);
  await expect(page.getByTestId("update-bar")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("login")).toBeVisible();
  // Wait for the worker to control the page rather than for a clock: the
  // negative assertion is only meaningful once the first-install branch of
  // offerIfUpdate had its chance to run.
  await page.evaluate(() =>
    "serviceWorker" in navigator
      ? Promise.race([
          navigator.serviceWorker.ready.then(() => "ready"),
          new Promise((r) => setTimeout(() => r("timeout"), 5000)),
        ])
      : "unsupported",
  );
  await page.waitForTimeout(500);
  await expect(page.getByTestId("update-bar")).toHaveCount(0);
});
