import { defineConfig, devices } from "@playwright/test";

// Defaults to production; override with E2E_BASE_URL=http://localhost:5173
// (with `pnpm dev` running). CI points this at the per-PR Pages preview
// and at a local stack.
// Production is the default target and stays read-only: signed-in specs call requireTestAuth and skip where test-login is unavailable.
const baseURL = process.env["E2E_BASE_URL"] ?? "https://feedme2-webapp.pages.dev";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // specs will share one D1 from Phase 1 on
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure", actionTimeout: 10_000 },
  projects: [
    {
      // Phones first: the suite runs at a handset profile.
      name: "chromium",
      use: { ...devices["Pixel 7"] },
      // Help scenarios have their own project: they refuse to run anywhere but a local stack
      // (e2e/help/help-fixtures.ts, requireLocalTarget).
      testIgnore: /help\//,
    },
    {
      name: "help",
      use: { ...devices["Pixel 7"] },
      testMatch: /help\/.*\.spec\.ts/,
      // Longer than the 30s default because every scenario in this project pays two cold starts before its first
      // step: the first pull (the dashboard's cat cards, waited for in help-fixtures.ts) and vite's first transform
      // of the App module graph, since this suite runs against `pnpm dev` rather than a build.
      //
      // gigsy learned the default was the real ceiling: a test cannot outlive its timeout, so the fixture's own
      // longer wait could never expire and a hydration failure surfaced as a pending locator instead. The fixture
      // asks for 60s inside this 90s, so a genuine hydration failure reports itself rather than the test clock.
      timeout: 90_000,
      // …and a matching budget for the assertions INSIDE that timeout. Raising the test timeout alone was an
      // incomplete fix in gigsy: Playwright's default `expect` timeout is 5s, so every bare `toBeVisible()` still had
      // five seconds to survive the same two cold starts (reproduced there: failed on the first run against a
      // freshly started dev server, then passed three times in a row once warm). 15s is well inside the 90s, so a
      // genuine failure still reports itself as the assertion that failed rather than the test clock running out.
      expect: { timeout: 15_000 },
    },
  ],
});
