import { HelpTarget } from "../targets.ts";
import type { HelpScenario } from "../types.ts";

/**
 * Adding a cat. The person's one tap opens the editor sheet (harmless:
 * it writes nothing, and closing the sheet discards it); the rest are
 * highlights. The tour never types a name or presses the save button.
 *
 * The editor's fields exist only while the sheet is open (CatEditor is
 * mounted on `editing !== null` in Settings.tsx), which is why the click
 * comes first: each step's target is resolved when that step is reached,
 * not up front (TourRenderer.ts).
 *
 * The branch comes before the click because a house at MAX_CATS (8)
 * shows "Add a cat" disabled, and a click step there waited on a tap
 * that could never happen. Both conditions are positive and come from
 * the loaded cat list: `cat-limit` (the "up to 8 cats" note) and
 * `cat-row` render in the same commit, so `room-for-another` is reached
 * only once the list is up and the note's absence is a fact about the
 * house, not about loading. `cat-add` is no condition at all: it is on
 * screen, enabled, while the list is still empty and loading.
 */
export const addACat: HelpScenario = {
  id: "add-a-cat",
  title: "Add a cat",
  description: "Name, colour and how soon it gets hungry.",
  category: "cats",
  startRoute: "/settings",
  // The CI fixture seeds two cats, well under the limit.
  expectedCiBranches: ["room-for-another"],
  steps: [
    {
      action: "branch",
      branches: [
        {
          id: "house-full",
          when: { type: "target-visible", target: HelpTarget.CatLimit },
          steps: [
            {
              action: "highlight",
              target: HelpTarget.CatLimit,
              title: "This house is full",
              description:
                "A house can have up to 8 cats, so Add a cat is greyed out. To add another, delete a cat above first; its feedings are kept.",
              end: true,
            },
          ],
        },
        {
          id: "room-for-another",
          when: { type: "target-visible", target: HelpTarget.CatRow },
          steps: [
            {
              action: "click",
              target: HelpTarget.CatAdd,
              title: "Add a cat",
              description: "In Settings, under Cats, tap Add a cat to open the editor.",
            },
            {
              action: "highlight",
              target: HelpTarget.CatName,
              title: "Name",
              description: "Type a name, up to 32 characters. It can't be left empty.",
            },
            {
              action: "highlight",
              target: HelpTarget.CatColors,
              title: "Colour",
              description:
                "Pick a colour. It is the cat's colour on its card and in the charts. Colours another cat already uses are dimmed.",
            },
            {
              action: "highlight",
              target: HelpTarget.CatSave,
              title: "Add cat",
              description:
                "After the avatar and \"Hungry after\", this adds the cat, and its card appears on the dashboard.",
              end: true,
            },
          ],
        },
      ],
    },
  ],
};
