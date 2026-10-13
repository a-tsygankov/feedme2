import { HelpTarget } from "../targets.ts";
import type { HelpScenario } from "../types.ts";

/** Pairing a feeder. Highlights only: the code comes from the device in
 *  the person's hand, so there is nothing a tour could type, and Pair
 *  stays disabled until six digits are in (DevicesSection.tsx). */
export const pairADevice: HelpScenario = {
  id: "pair-a-device",
  title: "Pair a device",
  description: "Connect a feedme2 display to this house with its 6-digit code.",
  category: "devices",
  startRoute: "/settings",
  steps: [
    {
      action: "highlight",
      target: HelpTarget.Devices,
      title: "Devices",
      description:
        "Every device paired with this house, and when each last synced. Rename or forget one here; a forgotten device is signed out.",
    },
    {
      action: "highlight",
      target: HelpTarget.PairCode,
      title: "The code",
      description: "Enter the 6-digit code shown on the device's screen.",
    },
    {
      action: "highlight",
      target: HelpTarget.PairSubmit,
      title: "Pair",
      description:
        "Tap Pair once all six digits are in. You can name the device first; it is optional.",
      end: true,
    },
  ],
};
