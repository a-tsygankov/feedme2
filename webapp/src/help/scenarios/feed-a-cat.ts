import { HelpTarget } from "../targets.ts";
import type { HelpScenario } from "../types.ts";

/**
 * Logging a feeding from the dashboard. Every step is a `highlight`:
 * tapping Feed would log a real feeding, so the tour points and the
 * person decides.
 *
 * Two branch steps in a row, because branches do not nest (validate.ts):
 *
 *   1. Is there a cat to feed? `cat-card` renders once house and cats
 *      have loaded; `empty-cats` only when the list loaded empty
 *      (Dashboard.tsx). Both positive, so a dashboard still loading
 *      matches neither and the branch waits, rather than reading
 *      "loading" as "no cats" (gigsy's `no-gigs-yet` incident).
 *   2. Does the cat have a usual amount yet? `cat-feed-more` ("Other…")
 *      exists only when it does (CatCard.tsx `hasDefault`); the usual
 *      amount is the amount of the cat's latest feeding by fed_at, not
 *      the last one logged (catDefaultsStatement in
 *      backend/src/repos/feedings.ts). The fallback condition is `cat-feed`, which is on screen in both
 *      cases: it is reached only because `can-feed-other` is checked
 *      first, and the two buttons render in the same card in the same
 *      commit, so there is no window where one is up and the other is
 *      about to arrive.
 *
 * `document.querySelector` finds the FIRST card's Feed button but the
 * first card that HAS an Other… button. In a house where only a later
 * cat has been fed, branch 2 takes `can-feed-other` while the Feed
 * spotlight sits on a cat with no usual amount yet; the copy stays true
 * of the button either way.
 */
export const feedACat: HelpScenario = {
  id: "feed-a-cat",
  title: "Log a feeding",
  description: "One tap feeds a cat its usual amount; Other… for anything else.",
  category: "cats",
  startRoute: "/",
  // The CI fixture seeds two cats with one feeding each, so the cards are
  // up and every cat has a usual amount.
  expectedCiBranches: ["cats-showing", "can-feed-other"],
  steps: [
    {
      action: "branch",
      branches: [
        {
          id: "cats-showing",
          when: { type: "target-visible", target: HelpTarget.CatCard },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.CatCard,
              title: "One card per cat",
              description:
                "The ring empties as the cat gets hungry, the line under the name says when it was last fed, and \"Today\" counts today's feedings and what they came to. Tap the cat to open its own page.",
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
                "There are no cats in this house yet. Add one in Settings (this button takes you there) and its card, with a Feed button, appears here.",
              end: true,
            },
          ],
        },
      ],
    },
    // Only `cats-showing` reaches here: `no-cats-yet` ended above.
    {
      action: "branch",
      branches: [
        {
          id: "can-feed-other",
          when: { type: "target-visible", target: HelpTarget.CatFeedMore },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.CatFeed,
              title: "Feed",
              description:
                "One tap logs the cat's usual amount, whatever you gave last time, right now. It works offline and syncs when you're back online.",
            },
            {
              action: "highlight",
              target: HelpTarget.CatFeedMore,
              title: "Other…",
              description:
                "Opens the feeding sheet for a different amount, an earlier time or a note. The latest feeding's amount becomes the usual one, so a feeding logged for an earlier time leaves it as it is.",
              end: true,
            },
          ],
        },
        {
          id: "first-feeding",
          when: { type: "target-visible", target: HelpTarget.CatFeed },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.CatFeed,
              title: "Feed",
              description:
                "The first time, Feed opens the feeding sheet so you can pick the amount. After that this button logs that usual amount in one tap, and an Other… button appears beside it for anything different.",
              end: true,
            },
          ],
        },
      ],
    },
  ],
};
