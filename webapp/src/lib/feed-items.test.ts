import { describe, expect, it } from "vitest";
import type { Cat } from "@feedme2/shared";
import { buildFeedItems, fedAtFrom, localInputValue, timeProblem } from "./feed-items.ts";

const settings = { gramStep: 5 as const, ozStepHundredths: 25 as const, canFractionStep: "1/4" as const, canSizeMg: 155922 };
const cat = (id: string, defaultAmountMg: number | null) => ({ id, name: id, defaultAmountMg }) as unknown as Cat;
const ids = (prefix = "id-") => (catId: string) => `${prefix}${catId}`;

describe("buildFeedItems", () => {
  const cats = [cat("a", 40_000), cat("b", 60_000), cat("c", null)];

  it("All cats: each cat's own default, and enteredValue matches that cat's amount (not the first cat's)", () => {
    const items = buildFeedItems({ cats, catId: undefined, mg: 40_000, fedAt: 1000, unit: "g", settings, note: "", ids: ids() });
    expect(items.map((i) => [i.catId, i.amountMg, i.enteredUnit, i.enteredValue])).toEqual([
      ["a", 40_000, "g", "40"],
      ["b", 60_000, "g", "60"],
      // No default: falls back to the stepper's mg.
      ["c", 40_000, "g", "40"],
    ]);
  });

  it("single cat: uses the stepped amount even when the cat has a different default", () => {
    const items = buildFeedItems({ cats, catId: "b", mg: 45_000, fedAt: 5, unit: "g", settings, note: "  ", ids: ids() });
    expect(items).toEqual([{ id: "id-b", catId: "b", fedAt: 5, amountMg: 45_000, enteredUnit: "g", enteredValue: "45" }]);
  });

  it("trims the note and omits it when blank", () => {
    const [withNote] = buildFeedItems({ cats, catId: "a", mg: 40_000, fedAt: 5, unit: "g", settings, note: " dry ", ids: ids() });
    expect(withNote?.note).toBe("dry");
  });

  it("edit mode: the caller's id function keeps the existing id", () => {
    const [item] = buildFeedItems({ cats, catId: "a", mg: 40_000, fedAt: 5, unit: "g", settings, note: "", ids: () => "existing" });
    expect(item?.id).toBe("existing");
  });

  it("asks for ids by cat so a retry can reuse them", () => {
    const asked: string[] = [];
    buildFeedItems({ cats, catId: undefined, mg: 1, fedAt: 5, unit: "g", settings, note: "", ids: (c) => { asked.push(c); return c; } });
    expect(asked).toEqual(["a", "b", "c"]);
  });
});

describe("fed-at time handling", () => {
  const now = Date.UTC(2026, 5, 1, 12, 30, 45);

  it("localInputValue round-trips through the datetime-local parser at minute precision", () => {
    expect(new Date(localInputValue(now)).getTime()).toBe(Math.floor(now / 60_000) * 60_000);
  });

  it("an ago chip subtracts minutes; a picked time wins over the chip", () => {
    expect(fedAtFrom({ customTime: "", agoMin: 15, now })).toBe(now - 15 * 60_000);
    const picked = localInputValue(now - 3_600_000);
    expect(fedAtFrom({ customTime: picked, agoMin: 15, now })).toBe(new Date(picked).getTime());
  });

  it("timeProblem tolerates 60 s of skew, rejects later, and rejects unparsable", () => {
    expect(timeProblem(now + 60_000, now)).toBeNull();
    expect(timeProblem(now + 60_001, now)).toMatch(/future/i);
    expect(timeProblem(NaN, now)).toMatch(/valid/i);
    expect(timeProblem(now - 86_400_000, now)).toBeNull();
  });
});
