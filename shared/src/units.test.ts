import { describe, expect, it } from "vitest";
import vectors from "../../fixtures/unit-vectors.json";
import {
  canParts, formatAmount, fromMg, GLYPH_TOLERANCE, parseEnteredValue, snapToStep, stepMg, toMg, type FoodUnit,
} from "./units.ts";

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

  it("parseEnteredValue grammar: the space is what separates a whole from a fraction", () => {
    expect(parseEnteredValue("11/2")).toBe(5.5);
    expect(parseEnteredValue("1 1/2")).toBe(1.5);
    expect(parseEnteredValue("1½")).toBe(1.5);
    expect(parseEnteredValue("1 ½")).toBe(1.5);
    expect(parseEnteredValue("1,5")).toBe(1.5);
    expect(parseEnteredValue(".5")).toBe(0.5);
    expect(parseEnteredValue("5.")).toBe(5);
    expect(parseEnteredValue("1\u00a01/2")).toBe(1.5);
    expect(parseEnteredValue("  1   1/2 ")).toBe(1.5);
  });
  it("parseEnteredValue rejects two numbers, junk and nonsense", () => {
    for (const bad of ["40 50", "1 2", "1 1.5", "1/2 1/2", "1/3/4", "", " ", ".", "1,2,3", "1.2.3", "1e3", "-1", "½½", "1/0", "0/5"]) {
      expect(parseEnteredValue(bad), bad).toBeNull();
    }
  });
  it("parseEnteredValue caps absurd values at 1,000,000", () => {
    expect(parseEnteredValue("1000000")).toBe(1_000_000);
    expect(parseEnteredValue("1000001")).toBeNull();
    expect(parseEnteredValue("99999999999999999999")).toBeNull();
  });
  it("canParts splits whole and glyph with the shared tolerance", () => {
    expect(GLYPH_TOLERANCE).toBe(0.02);
    expect(canParts(0.5)).toEqual({ whole: 0, glyph: "½" });
    expect(canParts(1)).toEqual({ whole: 1, glyph: "" });
    expect(canParts(1 + 1 / 3)).toEqual({ whole: 1, glyph: "⅓" });
    expect(canParts(0.0100)).toEqual({ whole: 0, glyph: "" });
    expect(canParts(0.4)).toEqual({ whole: 0, glyph: null });
    expect(canParts(0.25 + 0.019)).toEqual({ whole: 0, glyph: "¼" });
    expect(canParts(0.25 + 0.021)).toEqual({ whole: 0, glyph: null });
  });
  it("formatAmount never renders a bare ' can' for a tiny can amount", () => {
    expect(formatAmount(1560, "can", 155922)).toBe("0.01 can");
    expect(formatAmount(1, "can", 155922)).not.toBe(" can");
    expect(formatAmount(Number.NaN, "can", 155922)).toBe("—");
    expect(formatAmount(Number.POSITIVE_INFINITY, "g", 155922)).toBe("—");
  });
  it("snapToStep never lets NaN or a bad step reach a stored mg", () => {
    expect(snapToStep(Number.NaN, 5000)).toBe(5000);
    expect(snapToStep(Number.POSITIVE_INFINITY, 5000)).toBe(5000);
    expect(snapToStep(42000, 0)).toBe(0);
    expect(snapToStep(42000, Number.NaN)).toBe(0);
    expect(snapToStep(42000, -5)).toBe(0);
  });
  it("stepMg for grams is an integer even for fractional gramStep", () => {
    expect(stepMg("g", { gramStep: 0.1 + 0.2, ozStepHundredths: 25, canFractionStep: "1/4", canSizeMg: 155922 })).toBe(300);
  });
});
