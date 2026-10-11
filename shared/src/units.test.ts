import { describe, expect, it } from "vitest";
import vectors from "../../fixtures/unit-vectors.json";
import { formatAmount, fromMg, parseEnteredValue, snapToStep, stepMg, toMg, type FoodUnit } from "./units.ts";

describe("units (pinned by fixtures/unit-vectors.json)", () => {
  it("toMg matches every vector", () => {
    for (const v of vectors.toMg) expect(toMg(v.value, v.unit as FoodUnit, v.canSizeMg), JSON.stringify(v)).toBe(v.mg);
  });
  it("parseEnteredValue matches every vector", () => {
    for (const v of vectors.parse) {
      const got = parseEnteredValue(v.text);
      if (v.value === null) expect(got, v.text).toBeNull();
      else expect(got, v.text).toBeCloseTo(v.value, 6);
    }
  });
  it("formatAmount matches every vector", () => {
    for (const v of vectors.format) expect(formatAmount(v.mg, v.unit as FoodUnit, v.canSizeMg), JSON.stringify(v)).toBe(v.text);
  });
  it("stepMg matches every vector", () => {
    for (const v of vectors.steps) {
      expect(stepMg(v.unit as FoodUnit, { gramStep: v.gramStep, ozStepHundredths: v.ozStepHundredths, canFractionStep: v.canFractionStep as "1/4" | "1/3" | "1/2", canSizeMg: v.canSizeMg })).toBe(v.stepMg);
    }
  });
  it("fraction round-trip: 1/3 can → 51974 mg → ⅓ can → 52 g after a unit switch", () => {
    const mg = toMg(parseEnteredValue("1/3")!, "can", 155922);
    expect(mg).toBe(51974);
    expect(formatAmount(mg, "can", 155922)).toBe("⅓ can");
    expect(formatAmount(mg, "g", 155922)).toBe("52 g");
    expect(fromMg(mg, "oz", 155922)).toBeCloseTo(1.833, 2);
  });
  it("snapToStep rounds to the nearest multiple and never below one step", () => {
    expect(snapToStep(42000, 5000)).toBe(40000);
    expect(snapToStep(43000, 5000)).toBe(45000);
    expect(snapToStep(100, 5000)).toBe(5000);
  });
});
