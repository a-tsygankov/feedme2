/**
 * Shared setup for help-scenario specs, ported from gigsy's help-fixtures.ts.
 *
 * Two responsibilities: refusing to run anywhere but a local stack
 * (requireLocalTarget), and getting a scenario to the point its first step
 * can run (prepareHelpScenario): a fresh house, seeded through the API with
 * exactly what the scenarios' `expectedCiBranches` need, signed in the one
 * way this suite already signs in (helpers/test-auth.ts), then the
 * scenario's `startRoute`.
 *
 * Simpler than gigsy's on purpose. gigsy shares one dev user across every
 * spec, so its fixture spends most of its length RESETTING state other
 * suites left behind (a working week, a saved gig-list view, a walkable
 * gig). feedme2's test-login finds-or-creates a house by name, so each
 * scenario gets a house no other test has touched and nothing needs
 * resetting.
 */
import { expect, type Page } from "@playwright/test";
import { CAT_COLORS } from "../../../shared/src/api.ts";
import { requireTestAuth, signInAsTestHouse, uniqueHouseName, type TestSession } from "../helpers/test-auth.ts";
import type { HelpScenario } from "../../src/help/types.ts";

/** Hosts a local stack can legitimately be reached at. `"[::1]"` keeps its
 *  brackets because that is the literal form `URL#hostname` returns for an
 *  IPv6 literal (gigsy checked it against Node's own URL parser). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Refuses to run anywhere but a local stack.
 *
 * playwright.config.ts defaults `baseURL` to the production Pages
 * deployment. Production has no test-login, so the scenarios would skip
 * there, and a run that skips is exactly what must never read as green
 * (a gigsy preview job once went green while skipping most of its tests).
 * The help project exists to prove the tours against the hermetic stack
 * CI's `webapp-e2e-full` job brings up, and nowhere else.
 *
 * Allow-list, not deny-list (gigsy: an earlier version rejected only the
 * literal "pages.dev", and a custom domain, a workers.dev deployment or
 * odd casing sailed straight through).
 */
export function requireLocalTarget(): void {
  const raw = process.env["E2E_BASE_URL"];
  const target = raw?.trim();
  if (target === undefined || target === "") {
    throw new Error(
      "help:test requires E2E_BASE_URL pointing at a local stack (see the " +
        "webapp-e2e-full job in .github/workflows/deploy.yml). It must " +
        "never run against the production deployment.",
    );
  }

  let hostname: string;
  try {
    hostname = new URL(target).hostname.toLowerCase();
  } catch {
    throw new Error(
      "help:test requires E2E_BASE_URL to be a valid URL pointing at a " +
        `local stack, got ${JSON.stringify(target)}.`,
    );
  }

  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `help:test refuses to run against ${target}: these scenarios sign in ` +
        "as fresh test houses and seed them, so E2E_BASE_URL must point at a " +
        `local stack (localhost, 127.0.0.1, or ::1) — got host "${hostname}".`,
    );
  }
}

/** The two cats every scenario's house holds. Two, not one: `feed-all-cats`
 *  pins `two-or-more` and `read-reports` pins `two-cats`, and both
 *  controls exist only with two or more cats (never a selector with one
 *  option). */
export const HELP_CATS = ["Mochi", "Luna"] as const;

/** What one seeded feeding gives each cat: 40 g, entered in grams. */
const FEEDING_MG = 40_000;

/**
 * Seeds the house the scenarios expect, through the public API.
 *
 *  - Grams, pinned explicitly although it is the schema default:
 *    `change-units` pins `grams`, and that should not depend on a default
 *    staying what it is today.
 *  - Two cats, so Feed all and the Reports cat filter render.
 *  - One feeding each, an hour ago. The backend copies the latest
 *    feeding's amount onto the cat as its usual amount (repos/feedings.ts),
 *    which is what makes `cat-feed-more` ("Other…") render — `feed-a-cat`
 *    pins `can-feed-other`. An hour ago keeps it inside the current week
 *    /reports opens on, and well clear of the server's future-skew check.
 *
 * Fresh ids every call: cat and feeding ids are global primary keys and the
 * local D1 outlives a run.
 */
async function seedHelpHouse(page: Page, accessToken: string): Promise<void> {
  const headers = { authorization: `Bearer ${accessToken}` };

  const house = await page.request.patch("/api/house", { headers, data: { foodUnit: "g" } });
  expect(house.status(), await house.text()).toBe(200);

  const fedAt = Date.now() - 60 * 60 * 1000;
  const feedings = [];
  for (const [i, name] of HELP_CATS.entries()) {
    const id = crypto.randomUUID();
    const cat = await page.request.post("/api/cats", { headers, data: { id, name, color: CAT_COLORS[i] } });
    expect(cat.status(), await cat.text()).toBe(201);
    feedings.push({
      id: crypto.randomUUID(),
      catId: id,
      fedAt,
      amountMg: FEEDING_MG,
      enteredUnit: "g",
      enteredValue: String(FEEDING_MG / 1000),
    });
  }
  const fed = await page.request.post("/api/feedings", { headers, data: feedings });
  expect(fed.status(), await fed.text()).toBe(201);
}

/**
 * A fresh house seeded for the scenarios, signed in, with the dashboard's
 * first pull finished; then the scenario's `startRoute`.
 *
 * Calls `requireLocalTarget` itself rather than trusting every caller to
 * remember it: this is the one function that actually gets a scenario
 * running, so it is where the rule is enforced.
 *
 * Seeds BEFORE the browser signs in, so the dashboard's first load already
 * reads the seeded cats. test-login is find-or-create by name, so the
 * seeding login and `signInAsTestHouse`'s own login land on the same house.
 *
 * Waits for both cat cards before navigating anywhere. A Playwright context
 * starts with an empty cache, so the dashboard first renders nothing (house
 * and cats loading) and only then the cards; every scenario that branches
 * on the dashboard would otherwise race that first pull (gigsy:
 * `find-a-gig` took `no-gigs-yet` on an account of 396 gigs). 60s inside
 * the help project's 90s test timeout: a hydration failure must report
 * itself rather than the test clock (playwright.config.ts).
 */
export async function prepareHelpScenario(page: Page, scenario: HelpScenario): Promise<TestSession> {
  requireLocalTarget();
  await requireTestAuth(page);

  const houseName = uniqueHouseName("help");
  const seedLogin = await page.request.post("/api/auth/test-login", { data: { houseName } });
  expect(seedLogin.status(), await seedLogin.text()).toBe(200);
  const { accessToken } = (await seedLogin.json()) as TestSession;
  await seedHelpHouse(page, accessToken);

  const session = await signInAsTestHouse(page, houseName);
  await expect(page.getByTestId("cat-card")).toHaveCount(HELP_CATS.length, { timeout: 60_000 });

  if (scenario.startRoute !== undefined) {
    await page.goto(scenario.startRoute);
  }
  return session;
}
