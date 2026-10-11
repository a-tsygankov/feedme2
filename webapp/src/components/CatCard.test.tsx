// @vitest-environment jsdom
// Client render, not renderToStaticMarkup: react-router's Link logs a useLayoutEffect warning on the server renderer.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Cat, Feeding, House } from "@feedme2/shared";
import { CatCard, statusText } from "./CatCard.tsx";

const now = 1_000_000_000_000;

describe("statusText", () => {
  it("never says 'fed never'", () => {
    expect(statusText("starving", now, null)).toBe("Starving · Never fed");
  });
  it("combines the level label and the relative time", () => {
    expect(statusText("hungry", now, now - 5 * 3_600_000)).toBe("Hungry · fed 5 h ago");
  });
  it("does not repeat 'fed' at the fed level", () => {
    expect(statusText("fed", now, now - 30_000)).toBe("Fed just now");
  });
});

const house = { settings: { foodUnit: "g", canSizeMg: 155922 } } as unknown as House;
const cat = (over: Partial<Cat> = {}) =>
  ({ id: "c1", name: "Mochi", color: "#ccc", avatarPose: "B1", hungryAfterSec: 18000, lastFedAt: now - 60_000, defaultAmountMg: 40_000, ...over }) as unknown as Cat;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function render(c: Cat, todays: Feeding[] | undefined): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><CatCard cat={c} house={house} todays={todays} nowMs={now} onFeed={() => {}} onQuickFeed={() => {}} /></MemoryRouter>));
  const html = host.innerHTML;
  act(() => root.unmount());
  return html;
}

describe("CatCard", () => {
  it("shows an ellipsis, not zero, while today's feedings are loading", () => {
    const html = render(cat(), undefined);
    expect(html).toContain("Today: …");
    expect(html).not.toContain("0 feedings");
  });
  it("totals today's feedings once loaded", () => {
    const f = [{ amountMg: 40_000 }, { amountMg: 30_000 }] as unknown as Feeding[];
    expect(render(cat(), f)).toContain("Today: 2 feedings · 70 g");
    expect(render(cat(), [])).toContain("Today: 0 feedings");
  });
  it("offers the default amount as one tap plus a way to pick another; no default means only the sheet", () => {
    const withDefault = render(cat(), []);
    expect(withDefault).toContain("Feed 40 g");
    expect(withDefault).toContain('data-testid="cat-feed-more"');
    const without = render(cat({ defaultAmountMg: null }), []);
    expect(without).not.toContain("cat-feed-more");
  });
});
