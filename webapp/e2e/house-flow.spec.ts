import { test, expect, type Page } from "@playwright/test";
import { requireTestAuth, signInAsTestHouse, uniqueHouseName } from "./helpers/test-auth.ts";

/**
 * The Phase 1 exit test: a real house, real cats and real feedings against a local worker and D1.
 * Every test makes its own house (unique name), so the specs never depend on each other's data.
 * Skipped (or, with E2E_REQUIRE_AUTH=1, failed) where the target has no test-login, which is every production URL.
 */
test.describe("Phase 1 flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await requireTestAuth(page);
  });

  /** Settings → Add a cat → back to the dashboard, where the card must be showing. */
  async function addCat(page: Page, name: string) {
    await page.getByTestId("tab-settings").click();
    await page.getByTestId("cat-add").click();
    await page.getByTestId("cat-name").fill(name);
    await page.getByTestId("cat-save").click();
    await expect(page.getByTestId("cat-row").filter({ hasText: name })).toBeVisible();
    await page.getByTestId("tab-home").click();
    await expect(page.getByTestId("cat-card").filter({ hasText: name })).toBeVisible();
  }

  /** First feeding of a cat that has no default yet: "Feed" opens the sheet, one "+" step on the 40 g fallback makes 45 g. */
  async function feed45FromSheet(page: Page) {
    await page.getByTestId("cat-feed").click();
    await page.getByTestId("amount-inc").click();
    await expect(page.getByTestId("amount-value")).toHaveText("45 g");
    await page.getByTestId("feed-submit").click();
    await expect(page.getByTestId("feed-sheet")).toHaveCount(0);
  }

  test("setup → add a cat → feed from the sheet → feed again with one tap", async ({ page }) => {
    // Through the real form, a fresh name each run.
    await page.goto("/setup");
    await page.getByTestId("setup-name").fill(uniqueHouseName("e2e"));
    await page.getByTestId("setup-pin").fill("2468");
    await page.getByTestId("setup-pin2").fill("2468");
    await page.getByTestId("setup-submit").click();
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await expect(page.getByTestId("empty-cats")).toBeVisible();

    await addCat(page, "Mochi");
    const mochi = page.getByTestId("cat-card").filter({ hasText: "Mochi" });
    await expect(mochi).toHaveAttribute("data-level", "starving");
    await expect(mochi.getByTestId("cat-status")).toContainText("Never fed");

    await feed45FromSheet(page);
    await expect(mochi).toHaveAttribute("data-level", "fed");
    await expect(mochi.getByTestId("cat-today")).toContainText("1 feeding · 45 g");
    // The cat now has a default, so the primary button is the one-tap log.
    await expect(mochi.getByTestId("cat-feed")).toHaveText("Feed 45 g");
    await expect(mochi.getByTestId("cat-feed-more")).toBeVisible();

    await mochi.getByTestId("cat-feed").click();
    await expect(mochi.getByTestId("cat-today")).toContainText("2 feedings · 90 g");
    // The one tap logs straight away: no sheet.
    await expect(page.getByTestId("feed-sheet")).toHaveCount(0);

    // "Other…" is the way to a different amount or time once a default exists.
    await mochi.getByTestId("cat-feed-more").click();
    await expect(page.getByTestId("feed-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("feed-sheet")).toHaveCount(0);
  });

  test("settings: the food unit re-renders the card total, and a cat can be renamed", async ({ page }) => {
    await signInAsTestHouse(page, uniqueHouseName("e2e-set"));
    await addCat(page, "Mochi");
    await feed45FromSheet(page);
    const card = page.getByTestId("cat-card");
    await expect(card.getByTestId("cat-today")).toContainText("1 feeding · 45 g");

    await page.getByTestId("tab-settings").click();
    await page.getByTestId("food-unit").selectOption("oz");
    await expect(page.getByTestId("save-state")).toHaveText("Saved");
    await page.getByTestId("tab-home").click();
    // 45 g is 1.59 oz; the grams text must be gone, not merely joined by the new one.
    await expect(card.getByTestId("cat-today")).toContainText("1 feeding · 1.59 oz");
    await expect(card.getByTestId("cat-today")).not.toHaveText(/\d g/);
    await expect(card.getByTestId("cat-feed")).toHaveText("Feed 1.59 oz");

    await page.getByTestId("tab-settings").click();
    await page.getByTestId("cat-edit").click();
    await page.getByTestId("cat-name").fill("Mochi Jr");
    await page.getByTestId("cat-save").click();
    await expect(page.getByTestId("cat-row").filter({ hasText: "Mochi Jr" })).toBeVisible();
    await page.getByTestId("tab-home").click();
    await expect(card.filter({ hasText: "Mochi Jr" })).toBeVisible();
    // The rename leaves the feeding history alone.
    await expect(card.getByTestId("cat-today")).toContainText("1 feeding");
  });

  test("offline feeding queues, then syncs to the server when the network returns", async ({ page, context }) => {
    const session = await signInAsTestHouse(page, uniqueHouseName("e2e-off"));
    await addCat(page, "Pixel");
    await expect(page.getByTestId("sync-badge")).toHaveCount(0);

    await context.setOffline(true);
    await feed45FromSheet(page);
    await expect(page.getByTestId("sync-badge")).toContainText("to sync");
    // Optimistic: the card already shows the meal.
    await expect(page.getByTestId("cat-card")).toHaveAttribute("data-level", "fed");

    await context.setOffline(false);
    await expect(page.getByTestId("sync-badge")).toHaveCount(0, { timeout: 20_000 });

    const bearer = { Authorization: `Bearer ${session.accessToken}` };
    await expect
      .poll(async () => {
        const res = await page.request.get("/api/feedings", { headers: bearer });
        if (res.status() !== 200) return `status ${res.status()}`;
        const body = (await res.json()) as { items: Array<{ amountMg: number }> };
        return body.items.map((f) => f.amountMg);
      }, { timeout: 10_000 })
      .toEqual([45_000]);

    // The server's copy, as the cat page's history sees it. (Not a reload: the persisted query cache flushes on a
    // 1 s throttle, so a reload right after the sync can still paint the pre-sync cache. See the report.)
    await page.getByRole("link", { name: "Pixel details" }).click();
    await expect(page.getByTestId("feeding-row")).toHaveCount(1);
    await expect(page.getByTestId("feeding-row")).toContainText("45 g");
  });

  test("the cat page lists the feedings; one can be edited and one deleted", async ({ page }) => {
    const session = await signInAsTestHouse(page, uniqueHouseName("e2e-hist"));
    await addCat(page, "Mochi");
    await feed45FromSheet(page);
    const mochi = page.getByTestId("cat-card");
    await mochi.getByTestId("cat-feed").click();
    await expect(mochi.getByTestId("cat-today")).toContainText("2 feedings · 90 g");

    await mochi.getByRole("link", { name: "Mochi details" }).click();
    const rows = page.getByTestId("feeding-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "45 g" })).toHaveCount(2);

    // Edit the newest down by one gram step (5 g).
    await rows.first().getByTestId("feeding-edit").click();
    await expect(page.getByTestId("amount-value")).toHaveText("45 g");
    await page.getByTestId("amount-dec").click();
    await expect(page.getByTestId("amount-value")).toHaveText("40 g");
    await page.getByTestId("feed-submit").click();
    await expect(rows.filter({ hasText: "40 g" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "45 g" })).toHaveCount(1);

    // Delete asks for confirmation through window.confirm.
    page.once("dialog", (d) => void d.accept());
    await rows.filter({ hasText: "45 g" }).getByTestId("feeding-delete").click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("40 g");

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/feedings", { headers: { Authorization: `Bearer ${session.accessToken}` } });
        const body = (await res.json()) as { items: Array<{ amountMg: number }> };
        return body.items.map((f) => f.amountMg);
      }, { timeout: 10_000 })
      .toEqual([40_000]);
  });

  test("the hidden console, signed in, shows the house's worker feed after a refresh", async ({ page }) => {
    await signInAsTestHouse(page, uniqueHouseName("e2e-con"));
    await addCat(page, "Mochi");
    await feed45FromSheet(page);

    await page.getByRole("heading", { name: "feedme2" }).click({ clickCount: 3 });
    await expect(page.getByTestId("hidden-console")).toBeVisible();
    await expect(page.getByTestId("console-feed")).toContainText("app started");
    await expect(page.getByTestId("server-feed-unavailable")).toHaveCount(0);

    await page.getByTestId("console-refresh").click();
    await expect(page.locator('[data-testid="log-entry"][data-source="worker"]').first()).toBeVisible({ timeout: 10_000 });
  });
});
