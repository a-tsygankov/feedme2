/**
 * The single discovery mechanism — the help menu, the Playwright suite
 * and any future generator all read this and nothing else.
 */
import { addACat } from "./scenarios/add-a-cat.ts";
import { changeUnits } from "./scenarios/change-units.ts";
import { feedACat } from "./scenarios/feed-a-cat.ts";
import { feedAllCats } from "./scenarios/feed-all-cats.ts";
import { installApp } from "./scenarios/install-app.ts";
import { openReports } from "./scenarios/open-reports.ts";
import { pairADevice } from "./scenarios/pair-a-device.ts";
import { readReports } from "./scenarios/read-reports.ts";
import type { HelpScenario, HelpScenarioId } from "./types.ts";

/** Registration order is what orders a category's own section in the
 *  menu (HelpMenu's `groupScenarios`); the sections themselves follow
 *  CATEGORY_LABELS. Pinned by registry.test.ts. */
export const helpScenarios: HelpScenario[] = [
  openReports,
  feedACat,
  feedAllCats,
  addACat,
  changeUnits,
  pairADevice,
  readReports,
  installApp,
];

export function getHelpScenario(
  id: HelpScenarioId,
): HelpScenario | undefined {
  return helpScenarios.find((scenario) => scenario.id === id);
}

/** Installation lives in browser and OS chrome, so it is described but
 *  never executed. */
export const executableHelpScenarios: HelpScenario[] = helpScenarios.filter(
  (scenario) => scenario.executable !== false,
);
