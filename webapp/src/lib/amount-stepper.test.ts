import { describe, expect, it } from "vitest";
import { MAX_AMOUNT_MG, canStep, stepAmount, textForMg } from "./amount-stepper.ts";

const settings = { gramStep: 5 as const, ozStepHundredths: 25 as const, canFractionStep: "1/4" as const, canSizeMg: 155922 };

describe("amount stepper", () => {
  it("steps grams by the house step and never below one step", () => {
    expect(stepAmount(40000, +1, "g", settings)).toBe(45000);
    expect(stepAmount(5000, -1, "g", settings)).toBe(5000);
  });
  it("steps cans by the fraction step and keeps the entered value as a fraction", () => {
    // stepMg rounds the 1/4-can step to 38981 mg, so two steps are 77962 (not 2 x 38980.5).
    const mg = stepAmount(38981, +1, "can", settings);
    expect(mg).toBe(77962);
    expect(textForMg(mg, "can", settings)).toEqual({ enteredUnit: "can", enteredValue: "1/2" });
    expect(textForMg(40000, "g", settings)).toEqual({ enteredUnit: "g", enteredValue: "40" });
    expect(textForMg(42524, "oz", settings)).toEqual({ enteredUnit: "oz", enteredValue: "1.5" });
  });

  it("clamps at the schema maximum, on a step multiple", () => {
    expect(stepAmount(MAX_AMOUNT_MG, +1, "g", settings)).toBe(MAX_AMOUNT_MG);
    expect(stepAmount(4_998_000, +1, "g", settings)).toBeLessThanOrEqual(MAX_AMOUNT_MG);
    expect(stepAmount(4_998_000, +1, "g", settings) % 5000).toBe(0);
    expect(stepAmount(MAX_AMOUNT_MG - 1000, +1, "oz", settings)).toBeLessThanOrEqual(MAX_AMOUNT_MG);
  });
  it("canStep says when a button would do nothing", () => {
    expect(canStep(5000, -1, "g", settings)).toBe(false);
    expect(canStep(10_000, -1, "g", settings)).toBe(true);
    expect(canStep(MAX_AMOUNT_MG, +1, "g", settings)).toBe(false);
    expect(canStep(40_000, +1, "g", settings)).toBe(true);
  });
});
