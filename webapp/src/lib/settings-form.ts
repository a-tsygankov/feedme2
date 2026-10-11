import { MG_PER_OZ, type HousePatch, type HouseSettings } from "@feedme2/shared";

/** Spec Q5 default: 3 / 5.5 / 12.5 oz plus custom grams. */
export const CAN_PRESETS = [
  { label: "3 oz", mg: Math.round(3 * MG_PER_OZ) },
  { label: "5.5 oz", mg: Math.round(5.5 * MG_PER_OZ) },
  { label: "12.5 oz", mg: Math.round(12.5 * MG_PER_OZ) },
] as const;

export interface SettingsForm extends Omit<HouseSettings, "hungryAfterSecDefault" | "canSizeMg"> {
  hungryAfterHours: number;
  canSizeGrams: number;
}

export function formFromSettings(s: HouseSettings): SettingsForm {
  const { hungryAfterSecDefault, canSizeMg, ...rest } = s;
  return { ...rest, hungryAfterHours: hungryAfterSecDefault / 3600, canSizeGrams: canSizeMg / 1000 };
}

/**
 * Only the keys whose value differs from `current`, so a PATCH is minimal.
 * The result can be empty and the server rejects `{}`: callers must skip the
 * request then. A blank number input becomes NaN, which JSON turns into null
 * and the server rejects, so a non-finite value counts as "not changed".
 */
export function settingsPatchFromForm(form: SettingsForm, current: HouseSettings): HousePatch {
  const next: HouseSettings = {
    ...current,
    foodUnit: form.foodUnit, canFractionStep: form.canFractionStep, gramStep: form.gramStep, ozStepHundredths: form.ozStepHundredths,
    sleepTimeoutSec: form.sleepTimeoutSec, syncIntervalSec: form.syncIntervalSec, timezone: form.timezone,
    hungryAfterSecDefault: Math.round(form.hungryAfterHours * 3600),
    canSizeMg: Math.round(form.canSizeGrams * 1000),
  };
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(next) as Array<keyof HouseSettings>) {
    const v = next[k];
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    if (v !== current[k]) patch[k] = v;
  }
  return patch as HousePatch;
}
