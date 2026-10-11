import { test, type Page } from "@playwright/test";

/** What the dev-only test-login hands back; the app stores the refresh token and house, the specs use the access token for direct API checks. */
export interface TestSession {
  accessToken: string;
  refreshToken: string;
  house: { id: string; name: string };
}

/** A house name no earlier run has used: test-login finds-or-creates by name, so reuse would carry old cats over. */
export function uniqueHouseName(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Is the dev-only test-login live on this target? Production answers 404. */
export async function testAuthEnabled(page: Page): Promise<boolean> {
  const res = await page.request.post("/api/auth/test-login", { data: { houseName: uniqueHouseName("probe") } });
  return res.status() === 200;
}

/**
 * Skip unless the target has test auth, but with E2E_REQUIRE_AUTH=1 a skip is a failure. A preview job once
 * reported green while skipping most of the suite; this is the guard against that.
 */
export async function requireTestAuth(page: Page): Promise<void> {
  if (await testAuthEnabled(page)) return;
  if (process.env["E2E_REQUIRE_AUTH"] === "1") {
    throw new Error("test auth is not enabled on the target and E2E_REQUIRE_AUTH=1");
  }
  test.skip(true, "test auth not enabled on this target");
}

/** Signs a fresh PIN-less house in by seeding the same localStorage keys the auth store reads, then loads the dashboard. */
export async function signInAsTestHouse(page: Page, houseName: string): Promise<TestSession> {
  const res = await page.request.post("/api/auth/test-login", { data: { houseName } });
  if (res.status() !== 200) throw new Error(`test-login failed: ${res.status()}`);
  const tokens = (await res.json()) as TestSession;
  // localStorage is per origin, so the page must be on the app's origin first.
  await page.goto("/login");
  await page.evaluate(({ refreshToken, house }) => {
    localStorage.setItem("feedme2:refresh", refreshToken);
    localStorage.setItem("feedme2:house", JSON.stringify(house));
  }, tokens);
  await page.goto("/");
  return tokens;
}
