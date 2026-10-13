/**
 * What help scenarios point at, and the one fact that makes them work:
 * how an element's test ID relates to the thing a person touches.
 *
 * Ported from gigsy, where most interactive controls are a `Toggle` that
 * puts its test ID on a `peer sr-only` input — one pixel square — while
 * the switch you can see is a sibling span. Highlighting the tagged node
 * spotlights nothing, and clicking it in a test passes while proving
 * nothing a user could do. feedme2 has no such switch today, but the
 * `switch` kind stays so the first one added has somewhere to go.
 *
 * So kind is DECLARED, never derived from the name. In gigsy the name
 * lied in both directions: `push-toggle` was a Button, and
 * `toggle-prefix` was a switch for a calendar title prefix.
 */

export type HelpTargetKind = "element" | "switch";

export interface HelpTarget {
  readonly id: string;
  readonly kind: HelpTargetKind;
}

// Private on purpose: every target is declared in this file, next to the
// reason for its kind, rather than minted at a call site.
const element = (id: string): HelpTarget => ({ id, kind: "element" });
// Unused: feedme2 has no painted switch yet; kept so the first one has a home.
const painted = (id: string): HelpTarget => ({ id, kind: "switch" });

/** Deliberately shares its name with the interface above — one is a type,
 *  the other a value, and `HelpTarget.TabReports` is how call sites
 *  want to read.
 *
 *  Every entry is an existing `data-testid` on a feedme2 screen, checked
 *  against the markup: renaming one of those ids breaks the tour that
 *  uses it, which the help e2e suite catches. All are `element`: none
 *  of them is an sr-only input behind painted chrome. Where a control is
 *  rendered only in some states, the condition is noted, because that is
 *  what the scenarios branch on. */
export const HelpTarget = {
  // TabBar.tsx — NavLinks, on every signed-in screen.
  TabReports: element("tab-reports"),
  TabSettings: element("tab-settings"),
  // Header "?" (AppHeader.tsx), on every signed-in screen.
  HelpLink: element("help-link"),

  // Dashboard.tsx / CatCard.tsx. `cat-card` once house and cats have
  // loaded; `empty-cats` only when the cat list loaded empty;
  // `feed-all` only with two or more cats (rendered in the same commit
  // as the cards); `cat-feed-more` only when the cat has a default
  // amount, i.e. after its first feeding.
  CatCard: element("cat-card"),
  CatFeed: element("cat-feed"),
  CatFeedMore: element("cat-feed-more"),
  FeedAll: element("feed-all"),
  EmptyCats: element("empty-cats"),

  // Settings.tsx Cats section, and CatEditor.tsx (a sheet opened by
  // `cat-add`; the editor's fields exist only while it is open).
  CatAdd: element("cat-add"),
  CatName: element("cat-name"),
  CatColors: element("cat-colors"),
  CatSave: element("cat-save"),

  // Settings.tsx Units section: exactly one unit's controls at a time.
  // `gram-step` and `oz-step` were added for help (Phase 5b) so each
  // unit has something positive to branch on.
  FoodUnit: element("food-unit"),
  GramStep: element("gram-step"),
  OzStep: element("oz-step"),
  CanSize: element("can-size"),

  // DevicesSection.tsx, inside Settings' Devices section.
  Devices: element("devices"),
  PairCode: element("pair-code"),
  PairSubmit: element("pair-submit"),

  // Reports: ReportControls.tsx is always rendered once the house has
  // loaded; `report-cat` only with two or more live cats. The summary
  // (charts, `report-drill`) only once the report has loaded, and
  // `report-drill` only for a range finer than one day (a one-day range
  // lists each feeding instead). `report-offline` when the report could
  // not be fetched for want of a connection and nothing is cached.
  ReportRange: element("report-range"),
  ReportTitle: element("report-title"),
  ReportPrev: element("report-prev"),
  ReportNext: element("report-next"),
  ReportCat: element("report-cat"),
  ReportCsv: element("report-csv"),
  ReportChart: element("report-chart-feedings"),
  ReportDrill: element("report-drill"),
  ReportOffline: element("report-offline"),
} as const;

/** The CSS form of a target, for anything that needs a selector rather
 *  than a node: Playwright locators, and Driver.js's `element`, which
 *  must be a string so that `waitForElement` can re-query it as the DOM
 *  changes under a running tour (TourRenderer.ts).
 *
 *  So this is production code, not test-only. What keeps the unescaped
 *  interpolation safe is that `t.id` is never user input: every id comes
 *  from a typed factory in this file, so no quote or bracket is reachable
 *  and there is nothing for it to break. Adding a target with a
 *  hand-written id containing anything outside `[A-Za-z0-9_-]` is what
 *  would change that — use `CSS.escape` here if it ever does.
 *
 *  Switch targets resolve through `:has()`, which is Safari 15.4+ and
 *  every current evergreen browser. That is a deliberate acceptance:
 *  the alternative is a node, and a node cannot survive the re-query
 *  that makes a not-yet-rendered target reachable. */
export function targetSelector(t: HelpTarget): string {
  return t.kind === "switch"
    ? `label:has([data-testid="${t.id}"]) span[aria-hidden="true"]`
    : `[data-testid="${t.id}"]`;
}

/** The resolved node behind a target, walked rather than selected.
 *
 *  Not the spotlight path: the spotlight is Driver.js's own, and it goes
 *  through `targetSelector` and therefore through `:has()`. This is what
 *  callers use when they need the element itself — `conditionHolds` in
 *  TourRenderer.ts, which measures a branch condition's target for
 *  visibility and cannot do that to a selector string. Walking stays
 *  because it is the one form that needs no selector-engine support at
 *  all. */
export function resolveTarget(t: HelpTarget): HTMLElement | null {
  const tagged = document.querySelector<HTMLElement>(
    `[data-testid="${CSS.escape(t.id)}"]`,
  );
  if (tagged === null) return null;
  if (t.kind === "element") return tagged;
  return (
    tagged
      .closest("label")
      ?.querySelector<HTMLElement>('span[aria-hidden="true"]') ?? null
  );
}
