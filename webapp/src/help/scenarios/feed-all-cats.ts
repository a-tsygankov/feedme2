import { HelpTarget } from "../targets.ts";
import type { HelpScenario } from "../types.ts";

/**
 * "Feed all" exists only with two or more cats (Dashboard.tsx; spec
 * §4.3, never a choice with one option), so the tour branches on what is
 * shown.
 *
 * `one-cat` is a positive condition made safe by ORDER: a card is on
 * screen in both houses, and that alternative is reached only because
 * `two-or-more` is checked first. `feed-all` and the cards render under
 * the same `h && cats.data` in the same commit, so once a card is
 * visible the button's absence is a fact about the house, not about
 * loading (gigsy lesson: never branch on a missing target).
 */
export const feedAllCats: HelpScenario = {
  id: "feed-all-cats",
  title: "Feed every cat at once",
  description: "Log one feeding for each cat with a single sheet.",
  category: "cats",
  startRoute: "/",
  // The CI fixture seeds two cats.
  expectedCiBranches: ["two-or-more"],
  steps: [
    {
      action: "branch",
      branches: [
        {
          id: "two-or-more",
          when: { type: "target-visible", target: HelpTarget.FeedAll },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.FeedAll,
              title: "Feed all",
              description:
                "Opens the feeding sheet for every cat at once. Each cat that has a usual amount gets its own; the rest get the amount you pick in the sheet.",
            },
          ],
        },
        {
          id: "one-cat",
          when: { type: "target-visible", target: HelpTarget.CatCard },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.CatCard,
              title: "Just one cat",
              description:
                "Feed all appears under the cards once you have two cats. Until then, this card's Feed button is all you need.",
              end: true,
            },
          ],
        },
        {
          id: "no-cats-yet",
          when: { type: "target-visible", target: HelpTarget.EmptyCats },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.EmptyCats,
              title: "Add a cat first",
              description:
                "There are no cats in this house yet. Add them in Settings; with two or more, a Feed all button appears here.",
              end: true,
            },
          ],
        },
      ],
    },
  ],
};
