import { test, expect } from "@playwright/test";

test("the shell loads with the wordmark and its version", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/feedme2/);
  await expect(page.getByRole("heading", { name: "feedme2" })).toBeVisible();
  await expect(page.getByTestId("shell-version")).toContainText(/v\d+\.\d+\.\d+/);
});

test("client-routed URLs are served by the SPA fallback", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByTestId("shell")).toBeVisible();
});

/**
 * A false "update available" trains people to dismiss the bar, so the
 * real one gets dismissed too. First install must not raise it.
 */
test("no update bar on an ordinary load, nor after a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("shell")).toBeVisible();
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
  await expect(page.getByTestId("shell")).toBeVisible();
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
