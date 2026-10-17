/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpProvider } from "../help/runtime/HelpProvider.tsx";

// The header's other neighbours (console, house query, sync engine) are not what this file is about.
vi.mock("./ConsoleProvider.tsx", () => ({ useConsole: () => ({ tapLogo: () => {} }) }));
vi.mock("../hooks/use-house.ts", () => ({ useHouse: () => ({ data: { name: "Home" } }) }));
vi.mock("./SyncBadge.tsx", () => ({ SyncBadge: () => null }));
vi.mock("../help/registry.ts", () => ({
  helpScenarios: [],
  executableHelpScenarios: [],
  getHelpScenario: () => undefined,
}));

import { AppHeader } from "./AppHeader.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("AppHeader help button", () => {
  it("points aria-controls at the help sheet it opens", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <MemoryRouter initialEntries={["/"]}>
          <HelpProvider>
            <AppHeader />
          </HelpProvider>
        </MemoryRouter>,
      );
    });
    const button = container.querySelector<HTMLButtonElement>('[data-testid="help-link"]')!;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const sheet = container.querySelector<HTMLElement>('[data-testid="help-sheet"]')!;
    expect(sheet.id).not.toBe("");
    expect(button.getAttribute("aria-controls")).toBe(sheet.id);
  });
});
