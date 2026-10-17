import { HelpTarget } from "../targets.ts";
import type { HelpScenario } from "../types.ts";

/** The simplest thing that proves model, tour and runner agree (gigsy's
 *  `open-settings` plays the same part there). One `click`, and the
 *  click is harmless: it only changes screen.
 *
 *  Starts on "/" rather than "/reports" so the tap is a real move. The
 *  route change happens after the tour's last step, so HelpProvider has
 *  nothing to tolerate and no `navigate` step is needed. */
export const openReports: HelpScenario = {
  id: "open-reports",
  title: "Open Reports",
  description: "See every feeding by day, week or month.",
  category: "getting-started",
  startRoute: "/",
  steps: [
    {
      action: "click",
      target: HelpTarget.TabReports,
      title: "Open Reports",
      description:
        "Tap Reports, at the bottom. It shows every feeding by day, week or month, for all cats or one.",
    },
  ],
};
