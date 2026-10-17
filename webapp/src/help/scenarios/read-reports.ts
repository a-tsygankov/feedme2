import { HelpTarget } from "../targets.ts";
import type { HelpScenario } from "../types.ts";

/**
 * Reading a report. Highlights only: every control here changes the URL
 * or downloads a file, so the tour describes them and leaves the taps to
 * the person.
 *
 * Two branch steps, both on what Reports.tsx positively shows:
 *
 *   1. What sits under the charts. `report-drill` is the drill table,
 *      rendered once the report has loaded for any range finer than one
 *      day. It is there with or without feedings (a week always has
 *      seven rows), so the branch is `report-showing`, not "has
 *      feedings". A one-day range lists each feeding instead; `one-day`
 *      is reached on the feedings chart, which renders in the same
 *      commit as the drill table, so with the chart up and no table the
 *      range really is one day. `report-offline` is the "Reports need a
 *      connection" state; nothing else on the screen can be explained
 *      then, so it ends. Still loading or a server error match nothing,
 *      and the tour ends in "help isn't available right now".
 *   2. The cat filter, only with two or more live cats
 *      (ReportControls.tsx; never a selector with one option). `one-cat`
 *      is reached on the CSV button, which is always shown, so it is the
 *      ordered fallback. The one thing it cannot tell apart is a cat
 *      list still loading after the report has (the two queries run side
 *      by side), so its copy says when the filter appears rather than
 *      claiming the house has one cat.
 */
export const readReports: HelpScenario = {
  id: "read-reports",
  title: "Read your reports",
  description: "Move through days, weeks and months, drill down, filter by cat and export a CSV.",
  category: "reports",
  startRoute: "/reports",
  // The CI fixture seeds two cats with a feeding each, and /reports opens
  // on the current week, so the drill table and the cat filter are both
  // up.
  expectedCiBranches: ["report-showing", "two-cats"],
  steps: [
    {
      action: "highlight",
      target: HelpTarget.ReportTitle,
      title: "The range",
      description:
        "What you're looking at. Day, Week, Month or Custom, just above, changes the range; it opens on this week.",
    },
    {
      action: "highlight",
      target: HelpTarget.ReportPrev,
      title: "Back",
      description: "Moves back by the same range: a week at a time in Week, a month in Month.",
    },
    {
      action: "highlight",
      target: HelpTarget.ReportNext,
      title: "Forward",
      description: "Moves forward again by the same range.",
    },
    {
      action: "branch",
      branches: [
        {
          id: "report-showing",
          when: { type: "target-visible", target: HelpTarget.ReportDrill },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.ReportDrill,
              title: "Drill down",
              description:
                "Tap a row to open it: a month opens its weeks, a week its days, and a day lists each feeding. Back goes up a level. The bars in the charts open their period too.",
            },
          ],
        },
        {
          id: "one-day",
          when: { type: "target-visible", target: HelpTarget.ReportChart },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.ReportRange,
              title: "One day at a time",
              description:
                "A single day lists each feeding at the bottom. Pick Week or Month here for totals per day or per week, and tap a row to drill back down.",
            },
          ],
        },
        {
          id: "report-offline",
          when: { type: "target-visible", target: HelpTarget.ReportOffline },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.ReportOffline,
              title: "Reports need a connection",
              description:
                "Reports are worked out on the server, so they load only when you're online. Feeding still works offline and syncs later.",
              end: true,
            },
          ],
        },
      ],
    },
    // Only the two report alternatives reach here: offline ended above.
    {
      action: "branch",
      branches: [
        {
          id: "two-cats",
          when: { type: "target-visible", target: HelpTarget.ReportCat },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.ReportCat,
              title: "One cat or all",
              description:
                "Narrow every chart, the totals and the CSV to one cat, or pick All cats.",
            },
          ],
        },
        {
          id: "one-cat",
          when: { type: "target-visible", target: HelpTarget.ReportCsv },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.ReportCsv,
              title: "Download CSV",
              description:
                "Saves every feeding in this range as a spreadsheet file (it needs a connection). Once the house has two cats, a Cat filter appears above to narrow the report and the CSV to one.",
              end: true,
            },
          ],
        },
      ],
    },
    {
      action: "highlight",
      target: HelpTarget.ReportCsv,
      title: "Download CSV",
      description:
        "Saves every feeding in this range, for the cat you picked, as a spreadsheet file. It needs a connection.",
      end: true,
    },
  ],
};
