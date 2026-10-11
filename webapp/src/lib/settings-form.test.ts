import { describe, expect, it } from "vitest";
import type { HouseSettings } from "@feedme2/shared";
import { CAN_PRESETS, settingsPatchFromForm } from "./settings-form.ts";

const current: HouseSettings = { foodUnit: "g", canSizeMg: 155922, canFractionStep: "1/4", gramStep: 5, ozStepHundredths: 25, hungryAfterSecDefault: 18000, sleepTimeoutSec: 300, syncIntervalSec: 21600, timezone: "UTC" };

describe("settings form", () => {
  it("emits only the keys that changed", () => {
    expect(settingsPatchFromForm({ ...current, foodUnit: "can", hungryAfterHours: 5, canSizeGrams: 155.922 }, current)).toEqual({ foodUnit: "can" });
    expect(settingsPatchFromForm({ ...current, hungryAfterHours: 6, canSizeGrams: 155.922 }, current)).toEqual({ hungryAfterSecDefault: 21600 });
  });
  it("converts a custom can size in grams to mg and knows the presets", () => {
    expect(settingsPatchFromForm({ ...current, hungryAfterHours: 5, canSizeGrams: 85 }, current)).toEqual({ canSizeMg: 85000 });
    expect(CAN_PRESETS.map((p) => p.mg)).toEqual([85049, 155922, 354369]);
  });
  it("returns an empty patch when nothing changed (the server rejects {}, so callers must skip it)", () => {
    expect(settingsPatchFromForm({ ...current, hungryAfterHours: 5, canSizeGrams: 155.922 }, current)).toEqual({});
  });
  it("ignores a blank number input (NaN) instead of sending null", () => {
    expect(settingsPatchFromForm({ ...current, hungryAfterHours: Number.NaN, canSizeGrams: 155.922, sleepTimeoutSec: Number.NaN }, current)).toEqual({});
  });
});
