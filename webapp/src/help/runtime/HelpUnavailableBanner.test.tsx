/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { updateStore } from "../../lib/pwa-update-browser.ts";
import { HelpUnavailableBanner } from "./HelpUnavailableBanner.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(): HTMLDivElement {
  container = document.createElement("div");
  container.id = "root";
  document.body.appendChild(container);
  root = createRoot(container);
  return container;
}

function render(): void {
  act(() => {
    root!.render(
      <HelpUnavailableBanner
        message="This help step is currently unavailable."
        onBackToHelp={() => undefined}
        onDismiss={() => undefined}
      />,
    );
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  act(() => updateStore.dismiss());
});

describe("HelpUnavailableBanner", () => {
  it("waits until a modal sheet releases the inert app root", async () => {
    const el = mount();
    el.setAttribute("inert", "");
    render();

    expect(el.querySelector('[data-testid="help-unavailable"]')).toBeNull();

    await act(async () => {
      el.removeAttribute("inert");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(el.querySelector('[data-testid="help-unavailable"]')).not.toBeNull();
  });

  it("sits above the update bar instead of covering it", () => {
    const el = mount();
    render();
    const banner = el.querySelector<HTMLElement>('[data-testid="help-unavailable"]')!;
    expect(banner.className).toContain("bottom-0");

    act(() => updateStore.markReady("reload"));
    expect(banner.className).toContain("bottom-[calc(3rem+env(safe-area-inset-bottom))]");

    act(() => updateStore.dismiss());
    expect(banner.className).toContain("bottom-0");
  });
});
