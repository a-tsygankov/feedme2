/**
 * Help is reachable, starting a topic really starts a tour, and the sheet
 * behaves like the modal it says it is. Ported from gigsy's
 * reachability.spec.ts.
 *
 * scenarios.spec.ts drives every scenario through help-runner.ts, which is
 * Playwright acting out the *model*: it resolves targets and acts on them
 * itself. Nothing in it presses "?", sees the topic list, or loads
 * driver.js; the header button could be deleted and that suite would stay
 * green with help absent from the product. This spec covers the half the
 * runner structurally cannot: the entry point and the in-app tour runtime
 * (TourRenderer.ts + driver.js + styles/help.css).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { feedACat } from "../../src/help/scenarios/feed-a-cat.ts";
import { openReports } from "../../src/help/scenarios/open-reports.ts";
import { HelpTarget } from "../../src/help/targets.ts";
import { expectNoHorizontalOverflow } from "../helpers/ui.ts";
import { prepareHelpScenario, requireLocalTarget } from "./help-fixtures.ts";

// In a beforeEach, not at module top level: a top-level throw broke
// collection itself, so `test:e2e:ui` and `--list` (which load every
// project) died whenever E2E_BASE_URL was unset. Here each test still
// FAILS off a local stack (a skip would read as green), and nothing else
// is affected.
test.beforeEach(() => {
  requireLocalTarget();
});

/** Only TourRenderer's `popoverClass` puts `feedme2-help-popover` on a
 *  driver.js popover, and every rule in styles/help.css hangs off it. */
const POPOVER = ".driver-popover.feedme2-help-popover";

/** The centre of an element, in viewport coordinates, taken BEFORE help
 *  opens: once the backdrop is up, the point is what a finger lands on,
 *  whatever is now on top of it. */
async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("element has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The test id of whatever a tap at this point would hit. */
async function testIdAt(page: Page, point: { x: number; y: number }): Promise<string | null> {
  return page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid]")?.getAttribute("data-testid") ?? null, point);
}

test("help is reachable from Settings and starts a real tour", async ({ page, baseURL }) => {
  // Starts on /settings rather than where `open-reports` runs: the tour's
  // own hop to "/" is part of what is under test.
  await prepareHelpScenario(page, { ...openReports, startRoute: "/settings" });
  await expect(page.getByTestId("settings")).toBeVisible();

  const helpLink = page.getByTestId("help-link");
  await helpLink.click();
  const sheet = page.getByTestId("help-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("help-search")).toBeVisible();
  // The sheet is full width at the bottom of a 412 px phone; it must not
  // make the page wider than the screen.
  await expectNoHorizontalOverflow(page);

  // Picking a topic closes the sheet and starts the tour, which first
  // routes to the scenario's own startRoute.
  await sheet.getByTestId(`help-start-${openReports.id}`).click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(new URL(openReports.startRoute!, baseURL!).href);

  const popover = page.locator(POPOVER);
  await expect(popover).toBeVisible();
  // The one step's title is the scenario's own ("Open Reports").
  await expect(popover).toContainText(openReports.title);

  // driver.js's own `.driver-popover` caps width at 300px; help.css raises
  // it to 20rem. The computed value proves the stylesheet reached the page
  // and beat driver's base rule, which the class name alone cannot.
  await expect.poll(() => popover.evaluate((el) => getComputedStyle(el).maxWidth)).toBe("320px");

  // The spotlight is on the real control the scenario names.
  const tab = page.getByTestId(HelpTarget.TabReports.id);
  await expect(tab).toHaveClass(/driver-active-element/);

  // A popover on a 412 px phone stays inside the screen.
  await expectNoHorizontalOverflow(page);

  // The click step is the person's own tap: doing what the popover says
  // advances it, and with one step that ends the tour.
  await tab.click();
  await expect(page).toHaveURL(/\/reports/);
  await expect(popover).toBeHidden();
});

test("help is reachable from the dashboard header and tours a cat card", async ({ page }) => {
  await prepareHelpScenario(page, { ...feedACat, startRoute: "/" });

  await page.getByTestId("help-link").click();
  const sheet = page.getByTestId("help-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByTestId(`help-start-${feedACat.id}`).click();
  await expect(sheet).toBeHidden();

  // The tour resolves `cats-showing` on the seeded house and spotlights the
  // first card, as document.querySelector finds it.
  const popover = page.locator(POPOVER);
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("One card per cat");
  await expect(page.getByTestId(HelpTarget.CatCard.id).first()).toHaveClass(/driver-active-element/);
  await expectNoHorizontalOverflow(page);
});

test("help closes on a backdrop tap over the \"?\", on Enter on the focused button, and on Close", async ({ page }) => {
  await prepareHelpScenario(page, { ...openReports, startRoute: "/" });

  const helpLink = page.getByTestId("help-link");
  const sheet = page.getByTestId("help-sheet");
  const helpPoint = await centreOf(helpLink);

  await expect(helpLink).toHaveAttribute("aria-expanded", "false");
  await helpLink.click();
  await expect(sheet).toBeVisible();
  await expect(helpLink).toHaveAttribute("aria-expanded", "true");

  // A second tap where the "?" is closes help, but it is the BACKDROP that
  // closes it, not the button: the backdrop (z-50) sits over the sticky
  // header (z-30), so a pointer tap on "?" while help is open always lands
  // on the backdrop, whose own handler closes help. That is the intended
  // outcome (the person sees the button they opened help with close it);
  // only the keyboard below reaches the button itself. A plain locator
  // click would refuse ("backdrop intercepts pointer events"), so this
  // taps the point.
  await page.mouse.click(helpPoint.x, helpPoint.y);
  await expect(sheet).toBeHidden();
  await expect(helpLink).toHaveAttribute("aria-expanded", "false");
  // Focus goes back to the button that opened it.
  await expect(helpLink).toBeFocused();

  // From the keyboard the button itself toggles: Enter on it closes.
  await helpLink.click();
  await expect(sheet).toBeVisible();
  await helpLink.focus();
  await page.keyboard.press("Enter");
  await expect(sheet).toBeHidden();
  await expect(helpLink).toHaveAttribute("aria-expanded", "false");

  // And Close still works.
  await helpLink.click();
  await expect(sheet).toBeVisible();
  await sheet.getByTestId("help-sheet-close").click();
  await expect(sheet).toBeHidden();
  await expect(helpLink).toHaveAttribute("aria-expanded", "false");
});

test("the backdrop blocks the page behind help", async ({ page }) => {
  // The incident behind the backdrop: with help open, a cat's Feed button
  // above the sheet stayed tappable, and the feed sheet opened UNDER help
  // where it could not be used.
  await prepareHelpScenario(page, { ...feedACat, startRoute: "/" });

  const card = page.getByTestId("cat-card").first();
  // The seeded feeding, once today's feedings have loaded ("Today: …" until
  // then; reading it earlier made this test flaky).
  const today = card.getByTestId("cat-today");
  await expect(today).toHaveText("Today: 1 feeding · 40 g");
  // "Other…" is the button that opens the feed sheet once a cat has a usual
  // amount (the seeded cats do); "Feed" logs in one tap.
  const otherPoint = await centreOf(card.getByTestId(HelpTarget.CatFeedMore.id));
  const feedPoint = await centreOf(card.getByTestId(HelpTarget.CatFeed.id));

  const helpLink = page.getByTestId("help-link");
  const sheet = page.getByTestId("help-sheet");

  for (const point of [otherPoint, feedPoint]) {
    await helpLink.click();
    await expect(sheet).toBeVisible();
    // What a finger on that button would hit now: the backdrop, not the card.
    expect(await testIdAt(page, point)).toBe("help-sheet-backdrop");
    await page.mouse.click(point.x, point.y);
    // The tap closed help and did nothing else.
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("feed-sheet")).toHaveCount(0);
  }
  // No feeding was logged by the Feed tap either.
  await expect(today).toHaveText("Today: 1 feeding · 40 g");
});
