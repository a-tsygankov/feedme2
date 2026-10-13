/**
 * The single discovery mechanism — the help menu, the Playwright suite
 * and any future generator all read this and nothing else.
 */
import type { HelpScenario, HelpScenarioId } from "./types.ts";

/** Registration order is what orders a category's own section in the
 *  menu (HelpMenu's `groupScenarios`). Empty until feedme2's own
 *  scenarios are written (Phase 5b Task 3). */
export const helpScenarios: HelpScenario[] = [];

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
