/**
 * Test-only targets for the runtime suites ported from gigsy.
 *
 * feedme2's own `HelpTarget` map (../targets.ts) is empty until Phase 5b
 * Task 3 writes its scenarios, and its factories are private on purpose.
 * The renderer's tests are about Driver.js, branches and clicks, not about
 * any one screen, so they keep gigsy's target names and test ids here as
 * plain fixtures: the DOM each test builds uses these same ids, which is
 * what lets the test bodies stay verbatim copies of gigsy's.
 *
 * Imported by tests only; nothing in the app reads this file.
 */
import type { HelpTarget as Target } from "../targets.ts";

const element = (id: string): Target => ({ id, kind: "element" });
const painted = (id: string): Target => ({ id, kind: "switch" });

export const HelpTarget = {
  SettingsLink: element("settings-link"),
  SettingsNotifications: element("settings-notifications"),
  PushToggle: element("push-toggle"),
  PushUnavailable: element("push-unavailable"),
  GigList: element("gig-list"),
  GigFilters: element("gig-filters"),
  GigSearch: element("gig-search"),
  GigAdd: element("gig-add"),
  GigStatus: element("gig-status"),
  GigBreak: element("gig-break"),
  GigOverride: element("gig-override"),
  GigPayments: element("gig-payments"),
} as const;

/** gigsy's working-day switch: a `peer sr-only` input inside a label, so
 *  the visible thing is the painted sibling span — the `switch` kind. */
export const dayToggle = (i: number): Target => painted(`toggle-day-${i}`);

/** gigsy's start-time select: a real <select> carrying the test id. */
export const dayStart = (i: number): Target => element(`start-day-${i}`);
