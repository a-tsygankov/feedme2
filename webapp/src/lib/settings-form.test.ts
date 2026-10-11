import { describe, expect, it } from "vitest";
import type { HouseSettings, TokensResponse } from "@feedme2/shared";
import {
  CAN_PRESETS, canSizeMgFromGrams, deleteCatOutcome, formFromSettings, isValidTimezone, pinChangeFailure, pinChangeSuccess,
  pinFormError, presetForMg, settingsPatchFromForm,
} from "./settings-form.ts";

const current: HouseSettings = { foodUnit: "g", canSizeMg: 155922, canFractionStep: "1/4", gramStep: 5, ozStepHundredths: 25, hungryAfterSecDefault: 18000, sleepTimeoutSec: 300, syncIntervalSec: 21600, timezone: "UTC" };
const base = formFromSettings(current);

describe("settings form", () => {
  it("round-trips the current settings into an empty patch", () => {
    expect(settingsPatchFromForm(base, current)).toEqual({ patch: {}, errors: {} });
  });
  it("emits only the keys that changed (the server rejects {} so callers must skip it)", () => {
    expect(settingsPatchFromForm({ ...base, foodUnit: "can" }, current).patch).toEqual({ foodUnit: "can" });
    expect(settingsPatchFromForm({ ...base, hungryAfterHours: "6" }, current).patch).toEqual({ hungryAfterSecDefault: 21600 });
    expect(settingsPatchFromForm({ ...base, syncIntervalHours: "12" }, current).patch).toEqual({ syncIntervalSec: 43200 });
    expect(settingsPatchFromForm({ ...base, sleepTimeoutSec: "600" }, current).patch).toEqual({ sleepTimeoutSec: 600 });
  });
  it("converts a custom can size in grams to mg and knows the presets", () => {
    expect(settingsPatchFromForm({ ...base, canSizeGrams: "85" }, current).patch).toEqual({ canSizeMg: 85000 });
    expect(CAN_PRESETS.map((p) => p.mg)).toEqual([85049, 155922, 354369]);
  });
  it("treats a blank or non-numeric field as unchanged, never as 0 or null", () => {
    // A blank number input used to become 0 and be sent as an out-of-range value.
    for (const raw of ["", "   ", "abc"]) {
      expect(settingsPatchFromForm({ ...base, hungryAfterHours: raw, canSizeGrams: raw, sleepTimeoutSec: raw, syncIntervalHours: raw, timezone: raw.trim() === "" ? raw : current.timezone }, current)).toEqual({ patch: {}, errors: {} });
    }
  });
  it("rejects out-of-range values with the schema's bounds and still patches the valid ones", () => {
    const r = settingsPatchFromForm({ ...base, foodUnit: "oz", canSizeGrams: "5", hungryAfterHours: "25", sleepTimeoutSec: "30", syncIntervalHours: "0.5" }, current);
    expect(r.patch).toEqual({ foodUnit: "oz" });
    expect(Object.keys(r.errors).sort()).toEqual(["canSizeGrams", "hungryAfterHours", "sleepTimeoutSec", "syncIntervalHours"]);
  });
  it("accepts the bounds themselves", () => {
    expect(settingsPatchFromForm({ ...base, canSizeGrams: "10", hungryAfterHours: "1", sleepTimeoutSec: "60", syncIntervalHours: "24" }, current).errors).toEqual({});
    expect(settingsPatchFromForm({ ...base, canSizeGrams: "1000", hungryAfterHours: "24", sleepTimeoutSec: "3600", syncIntervalHours: "1" }, current).errors).toEqual({});
    expect(settingsPatchFromForm({ ...base, canSizeGrams: "1001" }, current).errors).toHaveProperty("canSizeGrams");
    expect(settingsPatchFromForm({ ...base, sleepTimeoutSec: "3601" }, current).errors).toHaveProperty("sleepTimeoutSec");
  });
  it("rejects fractional seconds for the sleep timeout (the schema wants an int)", () => {
    expect(settingsPatchFromForm({ ...base, sleepTimeoutSec: "90.5" }, current).errors).toHaveProperty("sleepTimeoutSec");
  });
  it("validates the timezone with the same Intl probe as the shared schema", () => {
    expect(isValidTimezone("Europe/Berlin")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(isValidTimezone("x".repeat(65))).toBe(false);
    const bad = settingsPatchFromForm({ ...base, timezone: "Not/AZone" }, current);
    expect(bad.patch).toEqual({});
    expect(bad.errors).toHaveProperty("timezone");
    expect(settingsPatchFromForm({ ...base, timezone: " Europe/Berlin " }, current).patch).toEqual({ timezone: "Europe/Berlin" });
  });
});

describe("can size state", () => {
  it("derives mg from a grams string, or null when it is not a valid size", () => {
    expect(canSizeMgFromGrams("85")).toBe(85000);
    expect(canSizeMgFromGrams("85.049")).toBe(85049);
    expect(canSizeMgFromGrams("")).toBeNull();
    expect(canSizeMgFromGrams("5")).toBeNull();
    expect(canSizeMgFromGrams("abc")).toBeNull();
  });
  it("selects a preset only when the size matches one exactly", () => {
    expect(presetForMg(155922)?.label).toBe("5.5 oz");
    expect(presetForMg(155000)).toBeUndefined();
  });
  it("a preset's grams string maps back to the same preset (picking one updates the custom field)", () => {
    for (const p of CAN_PRESETS) expect(presetForMg(canSizeMgFromGrams(String(p.mg / 1000))!)).toBe(p);
  });
});

describe("pin change", () => {
  it("validates format and confirmation before any request", () => {
    expect(pinFormError("1234", "5678", "5678")).toBeNull();
    expect(pinFormError("", "5678", "5678")).toMatch(/current/i);
    expect(pinFormError("1234", "12", "12")).toMatch(/4.12 digits/);
    expect(pinFormError("1234", "12ab", "12ab")).toMatch(/4.12 digits/);
    expect(pinFormError("1234", "1".repeat(13), "1".repeat(13))).toMatch(/4.12 digits/);
    expect(pinFormError("1234", "5678", "5679")).toMatch(/match/i);
  });
  const tokens: TokensResponse = {
    accessToken: "a", refreshToken: "r", expiresIn: 900,
    house: { id: "123e4567-e89b-42d3-a456-426614174000", name: "Mochi", settings: current, createdAt: 1, modifiedAt: 1 },
  };
  it("a 200 with tokens re-issues this phone", () => {
    const r = pinChangeSuccess(200, tokens);
    expect(r.tokens).not.toBeNull();
    expect(r.message).toBe("PIN changed. Other phones must sign in again.");
  });
  it("a 204 (old server) or an unparseable 200 succeeds without tokens and warns", () => {
    for (const r of [pinChangeSuccess(204, null), pinChangeSuccess(200, { nope: 1 })]) {
      expect(r.tokens).toBeNull();
      expect(r.message).toBe("PIN changed. Other phones must sign in again. This phone will need to sign in again soon.");
    }
  });
  it("maps failures to messages", () => {
    expect(pinChangeFailure({ status: 403, body: { error: "wrong_pin" } })).toBe("Current PIN is wrong.");
    expect(pinChangeFailure({ status: 400, body: { error: "wrong_pin" } })).toBe("Current PIN is wrong.");
    expect(pinChangeFailure({ status: 403, body: null })).toBe("Current PIN is wrong.");
    expect(pinChangeFailure(Object.assign(new Error("x"), { name: "NetworkError" }))).toBe("Check your connection.");
    expect(pinChangeFailure({ status: 401, body: { error: "unauthorized" } })).toBe("Could not change the PIN.");
    expect(pinChangeFailure(new Error("boom"))).toBe("Could not change the PIN.");
  });
});

describe("delete cat outcome", () => {
  it("maps statuses", () => {
    expect(deleteCatOutcome({ status: 409 })).toEqual({ kind: "error", message: "A house keeps at least one cat." });
    expect(deleteCatOutcome({ status: 404 })).toEqual({ kind: "gone" });
    expect(deleteCatOutcome({ status: 500 })).toEqual({ kind: "error", message: "Couldn't delete. Try again." });
    expect(deleteCatOutcome(new Error("x"))).toEqual({ kind: "error", message: "Couldn't delete. Try again." });
  });
});
