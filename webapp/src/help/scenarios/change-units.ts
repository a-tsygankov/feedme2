import { HelpTarget } from "../targets.ts";
import type { HelpScenario } from "../types.ts";

/**
 * The food unit and the control that goes with it. Read-only: the tour
 * points at the selects and never picks a value (a pick here saves the
 * house setting at once).
 *
 * Settings.tsx renders exactly one unit's controls: `gram-step` for
 * grams, `oz-step` for ounces, `can-size` (and the fraction step) for
 * cans. Each is positive, and all three render in the same commit as
 * `food-unit`, so the branch never sees a half-drawn section.
 * `gram-step` and `oz-step` were added for this scenario; without them
 * a grams or ounces house had nothing positive to branch on.
 */
export const changeUnits: HelpScenario = {
  id: "change-units",
  title: "Grams, ounces or cans",
  description: "Choose the unit every amount is shown and entered in.",
  category: "settings",
  startRoute: "/settings",
  // The CI fixture's house counts in grams (the default), so CI does not
  // take `cans`, the branch that shows Can size.
  expectedCiBranches: ["grams"],
  steps: [
    {
      action: "highlight",
      target: HelpTarget.FoodUnit,
      title: "Food unit",
      description:
        "Grams, ounces or cans. Every amount in the app (the Feed button, the feeding sheet, reports) is shown in it, and switching never changes a feeding already logged.",
    },
    {
      action: "branch",
      branches: [
        {
          id: "cans",
          when: { type: "target-visible", target: HelpTarget.CanSize },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.CanSize,
              title: "Can size",
              description:
                "How much one of your cans holds, so a quarter can still adds up correctly in reports. Pick Custom for a size that isn't listed.",
            },
          ],
        },
        {
          id: "grams",
          when: { type: "target-visible", target: HelpTarget.GramStep },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.GramStep,
              title: "Gram step",
              description: "How much each + or − adds when you set an amount in grams.",
            },
          ],
        },
        {
          id: "ounces",
          when: { type: "target-visible", target: HelpTarget.OzStep },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.OzStep,
              title: "Ounce step",
              description: "How much each + or − adds when you set an amount in ounces.",
            },
          ],
        },
      ],
    },
  ],
};
