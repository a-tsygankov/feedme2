/** @vitest-environment jsdom */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpProvider } from "./HelpProvider.tsx";
import { HELP_SHEET_ID, HelpSheet } from "./HelpSheet.tsx";

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

/** An opener that owns the open state the way AppHeader + HelpProvider
 *  do, so a close actually unmounts the sheet and focus restoration can
 *  be observed. Focus is put on the opener before it opens the sheet, as
 *  a real tap or Enter on the header's help-link would leave it. */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>Help</button>
      {open && <HelpSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function mountOpened(): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={["/"]}>
        <HelpProvider>
          <Harness />
        </HelpProvider>
      </MemoryRouter>,
    );
  });
  const opener = byId<HTMLButtonElement>(container, "opener")!;
  opener.focus();
  click(opener);
  expect(byId(container, "help-sheet")).not.toBeNull();
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

  it("has a stable id for the header button's aria-controls", () => {
    const el = mount();
    expect(byId(el, "help-sheet")!.id).toBe(HELP_SHEET_ID);
  });

  it("a tap on the backdrop closes it", () => {
    const el = mount();
    click(byId(el, "help-sheet-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a tap inside the sheet does not close it", () => {
    const el = mount();
    click(el.querySelector("#help-sheet-heading"));
    expect(onClose).not.toHaveBeenCalled();
  });

  // The incident: with help open, a cat's Feed button above the sheet was
  // still tappable; the FeedSheet then opened under help (portalled at
  // z-40, with help inside #root at z-50), could no longer be used, and
  // one Escape closed both. The backdrop has to cover the whole screen
  // at help's own layer and take the tap itself.
  it("covers the page behind it, so a tap there reaches the backdrop and not what is under it", () => {
    const behind = document.createElement("button");
    const onBehind = vi.fn();
    behind.addEventListener("click", onBehind);
    document.body.appendChild(behind);
    try {
      const el = mount();
      const backdrop = byId(el, "help-sheet-backdrop")!;
      expect(backdrop.className).toMatch(/\bfixed\b/);
      expect(backdrop.className).toMatch(/\binset-0\b/);
      expect(backdrop.className).toMatch(/\bz-50\b/);
      // The sheet sits above its backdrop, not under or inside it.
      expect(backdrop.contains(byId(el, "help-sheet"))).toBe(false);
      click(backdrop);
      expect(onBehind).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      behind.remove();
    }
  });

  it("returns focus to what had it after Escape", () => {
    const el = mountOpened();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(byId(el, "help-sheet")).toBeNull();
    expect(document.activeElement).toBe(byId(el, "opener"));
  });

  it("returns focus to what had it after Close", () => {
    const el = mountOpened();
    click(byId(el, "help-sheet-close"));
    expect(byId(el, "help-sheet")).toBeNull();
    expect(document.activeElement).toBe(byId(el, "opener"));
  });

  it("returns focus to what had it after a backdrop tap", () => {
    const el = mountOpened();
    click(byId(el, "help-sheet-backdrop"));
    expect(byId(el, "help-sheet")).toBeNull();
    expect(document.activeElement).toBe(byId(el, "opener"));
  });

  it("says there are no topics yet when the registry is empty, not that the search missed", () => {
    // "No help topic matches that." would blame a search nobody typed.
    const el = mount();
    expect(byId(el, "help-empty")!.textContent).toBe("No help topics yet.");
  });
});
