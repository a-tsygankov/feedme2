// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Cat, Feeding, FeedingCreate, House } from "@feedme2/shared";
import { FeedSheet } from "./FeedSheet.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const house = {
  id: "h", name: "H", settings: { foodUnit: "g", canSizeMg: 155_922, canFractionStep: "quarter", gramStep: 5, ozStepHundredths: 25, timezone: "UTC" },
} as unknown as House;
const cat = { id: "c1", name: "Mochi", defaultAmountMg: 40_000 } as unknown as Cat;
// Seconds and milliseconds on purpose: the time input only holds minutes.
const FED_AT = Date.now() - 3 * 3_600_000 - 37_123;
const feeding = { id: "f1", catId: "c1", fedAt: FED_AT, amountMg: 40_000, enteredUnit: "g", enteredValue: "40", note: null } as unknown as Feeding;

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

function open(editing?: Feeding) {
  const onSubmit = vi.fn<(items: FeedingCreate[]) => void>();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<FeedSheet house={house} cats={[cat]} initialCatId="c1" onClose={() => {}} onSubmit={onSubmit} {...(editing ? { editing } : {})} />));
  return onSubmit;
}
const submit = async () => { await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="feed-submit"]')!.click(); }); };

describe("FeedSheet edit mode", () => {
  it("submits the original fedAt untouched when the user never touched the time", async () => {
    const onSubmit = open(feeding);
    await submit();
    expect(onSubmit.mock.calls[0]![0][0]!.fedAt).toBe(FED_AT);
  });

  it("submits the chosen time once a time chip is tapped", async () => {
    const onSubmit = open(feeding);
    const before = Date.now();
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[data-testid="feed-time-chips"] button')].find((b) => b.textContent === "Now")!.click(); });
    await submit();
    expect(onSubmit.mock.calls[0]![0][0]!.fedAt).toBeGreaterThanOrEqual(before);
  });

  it("a new feeding still logs 'now'", async () => {
    const before = Date.now();
    const onSubmit = open();
    await submit();
    expect(onSubmit.mock.calls[0]![0][0]!.fedAt).toBeGreaterThanOrEqual(before);
  });
});
