/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { resolveTarget, targetSelector } from "./targets.ts";
import type { HelpTarget } from "./targets.ts";

// Local targets rather than entries from the HelpTarget map: these
// tests pin how a KIND resolves, which must not depend on which screens
// happen to have targets today.
const link: HelpTarget = { id: "settings-link", kind: "element" };
const sw: HelpTarget = { id: "some-switch", kind: "switch" };

/** The markup a painted switch renders (gigsy's components/Toggle.tsx,
 *  the shape the `switch` kind exists for): the test ID sits on a 1x1
 *  sr-only input, and the switch a person can see is a sibling span
 *  inside the wrapping label. */
function renderToggle(testId: string): HTMLElement {
  document.body.innerHTML = `
    <label class="inline-flex h-11 items-center">
      <input type="checkbox" role="switch" class="peer sr-only" data-testid="${testId}" />
      <span aria-hidden="true" class="relative h-6 w-11">
        <span class="absolute left-0.5 top-0.5"></span>
      </span>
    </label>`;
  return document.querySelector("span[aria-hidden='true']")!;
}

describe("resolveTarget", () => {
  it("returns the tagged node for an element target", () => {
    document.body.innerHTML = `<a data-testid="settings-link">Settings</a>`;
    const found = resolveTarget(link);
    expect(found?.tagName).toBe("A");
  });

  it("returns the painted switch, not the sr-only input, for a switch target", () => {
    const paint = renderToggle("some-switch");
    const found = resolveTarget(sw);
    expect(found).toBe(paint);
    expect(found?.tagName).toBe("SPAN");
  });

  it("returns null when the target is absent", () => {
    document.body.innerHTML = "";
    expect(resolveTarget(link)).toBeNull();
  });

  it("returns null when a switch target's paint is missing", () => {
    document.body.innerHTML = `<input data-testid="some-switch" />`;
    expect(resolveTarget(sw)).toBeNull();
  });
});

describe("targetSelector", () => {
  it("is a plain testid selector for an element target", () => {
    expect(targetSelector(link)).toBe(`[data-testid="settings-link"]`);
  });

  // The locator gigsy's e2e/settings.spec.ts proves correct against the
  // real component. Playwright proves it end to end; jsdom's :has()
  // support is not something to depend on.
  it("reaches the paint for a switch target", () => {
    expect(targetSelector(sw)).toBe(
      `label:has([data-testid="some-switch"]) span[aria-hidden="true"]`,
    );
  });
});
