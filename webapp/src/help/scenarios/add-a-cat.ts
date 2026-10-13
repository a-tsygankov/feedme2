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
 * Not covered: a house at MAX_CATS (8) shows "Add a cat" disabled, and
 * the click step would wait on a tap that cannot happen.
 */
export const addACat: HelpScenario = {
  id: "add-a-cat",
  title: "Add a cat",
  description: "Name, colour and how soon it gets hungry.",
  category: "cats",
  startRoute: "/settings",
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
      description: "Type a name, up to 32 characters. Each cat in the house needs its own.",
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
};
