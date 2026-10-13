import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  executableHelpScenarios,
  getHelpScenario,
  helpScenarios,
} from "./registry.ts";
import { matchesRoute } from "./routes.ts";
import { HelpTarget } from "./targets.ts";
import { groupScenarios } from "./runtime/HelpMenu.tsx";
import type { HelpScenario, HelpStep } from "./types.ts";
import { validateHelpRegistry } from "./validate.ts";

/** Every step a scenario can show: its own, each branch's, each variant's. */
function allSteps(scenario: HelpScenario): HelpStep[] {
  const out: HelpStep[] = [];
  const walk = (steps: HelpStep[]): void => {
    for (const step of steps) {
      out.push(step);
      if (step.action === "branch") for (const b of step.branches) walk(b.steps);
    }
  };
  walk(scenario.steps);
  for (const v of scenario.variants ?? []) walk(v.steps);
  return out;
}

/** The route patterns App.tsx declares, read from the source rather than
 *  restated here, so a renamed screen fails this suite instead of
 *  stranding a tour on the catch-all redirect to "/". */
function appRoutes(): string[] {
  const app = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");
  return [...app.matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((p) => p !== "*");
}

describe("the help registry", () => {
  it("is structurally valid", () => {
    expect(validateHelpRegistry(helpScenarios)).toEqual([]);
  });

  // Registration order is section order within a category (HelpMenu's
  // groupScenarios), so the list is pinned, not just its contents.
  it("registers feedme2's topics, once each, in the planned order", () => {
    const ids = helpScenarios.map((s) => s.id);
    expect(ids).toEqual([
      "open-reports",
      "feed-a-cat",
      "feed-all-cats",
      "add-a-cat",
      "change-units",
      "pair-a-device",
      "read-reports",
      "install-app",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lands each topic in its help-menu section, sections in menu order", () => {
    expect(
      groupScenarios("").map((g) => [g.category, g.scenarios.map((s) => s.id)]),
    ).toEqual([
      ["getting-started", ["open-reports"]],
      ["cats", ["feed-a-cat", "feed-all-cats", "add-a-cat"]],
      ["reports", ["read-reports"]],
      ["devices", ["pair-a-device"]],
      ["settings", ["change-units"]],
      ["installation", ["install-app"]],
    ]);
  });

  it("reads the routes App.tsx declares", () => {
    // Guards the parser below: an empty list would make every route
    // assertion vacuous.
    expect(appRoutes()).toEqual(
      expect.arrayContaining(["/", "/settings", "/reports", "/cats/:id"]),
    );
  });

  it("starts every executable topic on a route the app has", () => {
    const routes = appRoutes();
    for (const scenario of executableHelpScenarios) {
      expect(scenario.startRoute, scenario.id).toBeDefined();
      expect(
        routes.some((r) => matchesRoute(r, scenario.startRoute!)),
        `${scenario.id}: ${scenario.startRoute}`,
      ).toBe(true);
    }
  });

  it("navigates only to routes the app has", () => {
    const routes = appRoutes();
    for (const scenario of helpScenarios) {
      for (const step of allSteps(scenario)) {
        if (step.action !== "navigate") continue;
        // A navigate route is a pattern ("/cats/:id"); it must be one of
        // App.tsx's own patterns, not merely match one.
        expect(routes, `${scenario.id}: ${step.route}`).toContain(step.route);
      }
    }
  });

  // Tours never write data (plan Global Constraints): the person taps,
  // the tour points. An `input` or `select` step would make the tour
  // type into a field or pick a value, so feedme2 keeps both step types
  // unused even though the model ported from gigsy still has them.
  it("no topic types into a field or picks a value", () => {
    for (const scenario of helpScenarios) {
      const writes = allSteps(scenario).filter(
        (s) => s.action === "input" || s.action === "select",
      );
      expect(writes, scenario.id).toEqual([]);
    }
  });

  // At MAX_CATS Settings disables "Add a cat", so a tour that opened with
  // the click step waited on a tap that could never happen. The full-house
  // check must come first; the CI fixture (two cats) takes the other branch.
  it("add-a-cat checks for a full house before asking for the Add a cat tap", () => {
    const scenario = getHelpScenario("add-a-cat")!;
    const first = scenario.steps[0]!;
    expect(first.action).toBe("branch");
    if (first.action !== "branch") return;
    expect(first.branches.map((b) => b.id)).toEqual(["house-full", "room-for-another"]);

    const [full, room] = first.branches;
    expect(full!.when).toEqual({ type: "target-visible", target: HelpTarget.CatLimit });
    expect(full!.steps.map((s) => s.action)).toEqual(["highlight"]);
    expect(full!.steps.at(-1)).toMatchObject({ target: HelpTarget.CatLimit, end: true });
    expect(room!.steps[0]).toMatchObject({ action: "click", target: HelpTarget.CatAdd });

    expect(scenario.expectedCiBranches).toEqual(["room-for-another"]);
  });

  it("finds a scenario by id", () => {
    expect(getHelpScenario("feed-a-cat")?.id).toBe("feed-a-cat");
    expect(getHelpScenario("nope")).toBeUndefined();
  });

  // Pinned by id rather than re-derived with the same filter the
  // registry uses, so deleting that filter fails here.
  it("hands the Playwright runner only the scenarios that can execute", () => {
    const ids = executableHelpScenarios.map((s) => s.id);
    expect(ids).not.toContain("install-app");
    expect(ids).toEqual(
      helpScenarios.map((s) => s.id).filter((id) => id !== "install-app"),
    );
    expect(executableHelpScenarios.every((s) => s.executable !== false)).toBe(true);
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
