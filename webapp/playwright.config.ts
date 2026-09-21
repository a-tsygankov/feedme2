import { defineConfig, devices } from "@playwright/test";

// Defaults to production; override with E2E_BASE_URL=http://localhost:5173
// (with `pnpm dev` running). CI points this at the per-PR Pages preview
// and at a local stack.
// Production is the default target, so every spec here must stay read-only.
// When Phase 1 adds specs that write (feedings, cats), gate them on a
// non-production E2E_BASE_URL or a test-auth flag before they run.
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
    },
  ],
});
