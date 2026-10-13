import { describe, expect, it } from "vitest";
import {
  executableHelpScenarios,
  getHelpScenario,
  helpScenarios,
} from "./registry.ts";
import { validateHelpRegistry } from "./validate.ts";

describe("the help registry", () => {
  it("is structurally valid", () => {
    expect(validateHelpRegistry(helpScenarios)).toEqual([]);
  });

  it("returns undefined for an unknown id", () => {
    expect(getHelpScenario("nope")).toBeUndefined();
  });

  it("hands the Playwright runner only the scenarios that can execute", () => {
    expect(executableHelpScenarios.every((s) => s.executable !== false)).toBe(true);
    expect(
      helpScenarios.filter((s) => s.executable !== false).map((s) => s.id),
    ).toEqual(executableHelpScenarios.map((s) => s.id));
  });

  // gigsy's record-work once started on a hard-coded gig id that only
  // the Playwright fixture created, so on a real account the screen said
  // "Couldn't open this gig" and every step degraded to prose. A
  // scenario must reach a record the way a person does.
  it("no scenario carries a record id", () => {
    for (const scenario of helpScenarios) {
      expect(JSON.stringify(scenario), scenario.id).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
    }
  });
});
