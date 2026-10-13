import { describe, expect, it } from "vitest";
import { allowedRoutes, matchesRoute } from "./routes.ts";
import type { HelpTarget } from "./targets.ts";
import type { HelpScenario } from "./types.ts";

const list: HelpTarget = { id: "cat-list", kind: "element" };

describe("matchesRoute", () => {
  it("matches a literal pattern exactly", () => {
    expect(matchesRoute("/cats", "/cats")).toBe(true);
    expect(matchesRoute("/cats", "/cats/abc")).toBe(false);
    expect(matchesRoute("/cats", "/")).toBe(false);
  });

  it("does not match a longer literal that merely starts the same", () => {
    // The reason this is a segment comparison and not `startsWith`.
    expect(matchesRoute("/cats", "/catsy")).toBe(false);
  });

  it("matches exactly one segment per :param", () => {
    expect(matchesRoute("/cats/:id", "/cats/abc")).toBe(true);
    expect(matchesRoute("/cats/:id", "/cats/abc/edit")).toBe(false);
    expect(matchesRoute("/cats/:id", "/cats")).toBe(false);
  });

  it("treats a param as required, not optional", () => {
    expect(matchesRoute("/cats/:id", "/cats/")).toBe(false);
  });

  it("handles more than one param", () => {
    expect(matchesRoute("/a/:x/b/:y", "/a/1/b/2")).toBe(true);
    expect(matchesRoute("/a/:x/b/:y", "/a/1/c/2")).toBe(false);
  });
});

const base: HelpScenario = {
  id: "s",
  title: "S",
  category: "cats",
  startRoute: "/cats",
  steps: [
    {
      action: "highlight",
      target: list,
      description: "Here.",
    },
  ],
};

describe("allowedRoutes", () => {
  it("is just the start route when nothing navigates", () => {
    expect(allowedRoutes(base, "/somewhere")).toEqual(["/cats"]);
  });

  it("falls back to the given pathname when the scenario has no startRoute", () => {
    const { startRoute: _unused, ...noStart } = base;
    expect(allowedRoutes(noStart, "/somewhere")).toEqual(["/somewhere"]);
  });

  it("includes a navigate step's route", () => {
    const scenario: HelpScenario = {
      ...base,
      steps: [
        {
          action: "navigate",
          target: list,
          route: "/cats/:id",
          description: "Tap one.",
        },
      ],
    };
    expect(allowedRoutes(scenario, "/somewhere")).toEqual(["/cats", "/cats/:id"]);
  });

  it("reaches a navigate step nested inside a branch", () => {
    // Where a navigate step usually lives: the hop exists only when
    // the screen shows something to tap (gigsy's record-work keeps its
    // navigate step in exactly this place), so this is the case that
    // actually matters.
    const scenario: HelpScenario = {
      ...base,
      steps: [
        {
          action: "branch",
          branches: [
            {
              id: "showing",
              when: { type: "target-visible", target: list },
              steps: [
                {
                  action: "navigate",
                  target: list,
                  route: "/cats/:id",
                  description: "Tap one.",
                },
              ],
            },
          ],
        },
      ],
    };
    expect(allowedRoutes(scenario, "/somewhere")).toEqual(["/cats", "/cats/:id"]);
  });
});
