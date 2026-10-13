/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpProvider } from "./HelpProvider.tsx";
import { HelpSheet } from "./HelpSheet.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Pinned empty, so the empty-state test below keeps meaning "a house
// with no topics registered" after feedme2's own scenarios land.
vi.mock("../registry.ts", () => ({
  helpScenarios: [],
  executableHelpScenarios: [],
  getHelpScenario: () => undefined,
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const onClose = vi.fn();

/** The sheet mounted directly inside a HelpProvider — the menu needs
 *  `useHelp`, and the provider needs a router. The provider's own
 *  `isOpen` is left false so only this one sheet is in the tree. */
function mount(): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={["/"]}>
        <HelpProvider>
          <HelpSheet onClose={onClose} />
        </HelpProvider>
      </MemoryRouter>,
    );
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.clearAllMocks();
});

const byId = <T extends HTMLElement>(el: HTMLElement, id: string) =>
  el.querySelector<T>(`[data-testid="${id}"]`);

function click(el: HTMLElement | null): void {
  act(() => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("HelpSheet", () => {
  // gigsy's sheet has a second face, FeedbackForm; feedme2 has no
  // feedback endpoint, so the sheet is the menu and nothing else.
  it("opens on the menu, with Close and no feedback button", () => {
    const el = mount();
    expect(el.querySelector("#help-sheet-heading")!.textContent).toBe("Help");
    expect(byId(el, "help-search")).not.toBeNull();
    expect(byId(el, "help-sheet-close")).not.toBeNull();
    expect(byId(el, "help-feedback")).toBeNull();
  });

  it("moves focus to its heading on open", () => {
    const el = mount();
    expect(document.activeElement).toBe(el.querySelector("#help-sheet-heading"));
  });

  it("closes on Escape", () => {
    mount();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Close closes", () => {
    const el = mount();
    click(byId(el, "help-sheet-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says there are no topics yet when the registry is empty, not that the search missed", () => {
    // "No help topic matches that." would blame a search nobody typed.
    const el = mount();
    expect(byId(el, "help-empty")!.textContent).toBe("No help topics yet.");
  });
});
