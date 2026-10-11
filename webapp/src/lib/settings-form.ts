import { MG_PER_OZ, TokensResponseSchema, type HousePatch, type HouseSettings, type TokensResponse } from "@feedme2/shared";

/** Spec Q5 default: 3 / 5.5 / 12.5 oz plus custom grams. */
export const CAN_PRESETS = [
  { label: "3 oz", mg: Math.round(3 * MG_PER_OZ) },
  { label: "5.5 oz", mg: Math.round(5.5 * MG_PER_OZ) },
  { label: "12.5 oz", mg: Math.round(12.5 * MG_PER_OZ) },
] as const;

/**
 * Numeric fields are the raw input strings: a blank number input must mean
 * "unchanged", and Number("") is 0, which used to be sent as an out-of-range
 * value and bounced by the server.
 */
export interface SettingsForm extends Pick<HouseSettings, "foodUnit" | "canFractionStep" | "gramStep" | "ozStepHundredths" | "timezone"> {
  hungryAfterHours: string;
  canSizeGrams: string;
  sleepTimeoutSec: string;
  syncIntervalHours: string;
}

export type SettingsField = "hungryAfterHours" | "canSizeGrams" | "sleepTimeoutSec" | "syncIntervalHours" | "timezone";
export type SettingsErrors = Partial<Record<SettingsField, string>>;

export function formFromSettings(s: HouseSettings): SettingsForm {
  return {
    foodUnit: s.foodUnit, canFractionStep: s.canFractionStep, gramStep: s.gramStep, ozStepHundredths: s.ozStepHundredths, timezone: s.timezone,
    hungryAfterHours: String(s.hungryAfterSecDefault / 3600),
    canSizeGrams: String(s.canSizeMg / 1000),
    sleepTimeoutSec: String(s.sleepTimeoutSec),
    syncIntervalHours: String(s.syncIntervalSec / 3600),
  };
}

/** The same probe HouseSettingsSchema.timezone uses, so the client never accepts what the server rejects. */
export function isValidTimezone(tz: string): boolean {
  if (tz.length < 1 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** undefined for blank or non-numeric input: callers treat that as "unchanged". */
function parseNumber(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** The custom can size in mg, or null when the text is blank, non-numeric or outside 10–1000 g. */
export function canSizeMgFromGrams(raw: string): number | null {
  const g = parseNumber(raw);
  if (g === undefined || g < 10 || g > 1000) return null;
  return Math.round(g * 1000);
}

export function presetForMg(mg: number): (typeof CAN_PRESETS)[number] | undefined {
  return CAN_PRESETS.find((p) => p.mg === mg);
}

/**
 * Only the keys whose value differs from `current`, so a PATCH is minimal,
 * plus an inline error per field that is out of range. The patch can be empty
 * and the server rejects `{}`: callers must skip the request then.
 * Blank and non-numeric fields count as "not changed".
 */
export function settingsPatchFromForm(form: SettingsForm, current: HouseSettings): { patch: HousePatch; errors: SettingsErrors } {
  const patch: Record<string, unknown> = {};
  const errors: SettingsErrors = {};
  const set = (k: keyof HouseSettings, v: unknown) => { if (v !== current[k]) patch[k] = v; };

  if (form.foodUnit !== current.foodUnit) patch.foodUnit = form.foodUnit;
  if (form.canFractionStep !== current.canFractionStep) patch.canFractionStep = form.canFractionStep;
  if (form.gramStep !== current.gramStep) patch.gramStep = form.gramStep;
  if (form.ozStepHundredths !== current.ozStepHundredths) patch.ozStepHundredths = form.ozStepHundredths;

  const grams = parseNumber(form.canSizeGrams);
  if (grams !== undefined) {
    const mg = canSizeMgFromGrams(form.canSizeGrams);
    if (mg === null) errors.canSizeGrams = "Between 10 and 1000 g.";
    else set("canSizeMg", mg);
  }

  const hungry = parseNumber(form.hungryAfterHours);
  if (hungry !== undefined) {
    if (hungry < 1 || hungry > 24) errors.hungryAfterHours = "Between 1 and 24 hours.";
    else set("hungryAfterSecDefault", Math.round(hungry * 3600));
  }

  const sleep = parseNumber(form.sleepTimeoutSec);
  if (sleep !== undefined) {
    if (!Number.isInteger(sleep) || sleep < 60 || sleep > 3600) errors.sleepTimeoutSec = "Whole seconds, 60 to 3600.";
    else set("sleepTimeoutSec", sleep);
  }

  const sync = parseNumber(form.syncIntervalHours);
  if (sync !== undefined) {
    if (sync < 1 || sync > 24) errors.syncIntervalHours = "Between 1 and 24 hours.";
    else set("syncIntervalSec", Math.round(sync * 3600));
  }

  const tz = form.timezone.trim();
  if (tz !== "") {
    if (!isValidTimezone(tz)) errors.timezone = "Not a known timezone (for example Europe/Berlin).";
    else set("timezone", tz);
  }

  return { patch: patch as HousePatch, errors };
}

const PIN_FORMAT = /^\d{4,12}$/;

/** Client-side PIN checks that run before any request; null when the form is fine. */
export function pinFormError(current: string, next: string, confirm: string): string | null {
  if (current === "") return "Enter the current PIN.";
  if (!PIN_FORMAT.test(next)) return "New PIN must be 4–12 digits.";
  if (next !== confirm) return "The new PINs don't match.";
  return null;
}

const PIN_CHANGED = "PIN changed. Other phones must sign in again.";

/**
 * The server answers a PIN change with fresh tokens for this phone (every
 * other session is revoked). An older server answered 204; then this phone's
 * own refresh token is dead too, so warn instead of pretending all is well.
 */
export function pinChangeSuccess(_status: number, body: unknown): { message: string; tokens: TokensResponse | null } {
  const parsed = TokensResponseSchema.safeParse(body);
  if (parsed.success) return { message: PIN_CHANGED, tokens: parsed.data };
  return { message: `${PIN_CHANGED} This phone will need to sign in again soon.`, tokens: null };
}

const statusOf = (err: unknown): number | undefined => {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
};

/** Duck-typed (not instanceof) so this module stays free of the api client's import-time side effects. */
export function pinChangeFailure(err: unknown): string {
  if ((err as { name?: unknown } | null)?.name === "NetworkError") return "Check your connection.";
  const body = (err as { body?: { error?: unknown } | null } | null)?.body;
  if (statusOf(err) === 403 || body?.error === "wrong_pin") return "Current PIN is wrong.";
  return "Could not change the PIN.";
}

export type DeleteCatOutcome = { kind: "gone" } | { kind: "error"; message: string };

/** 404 means someone already removed it, which is the state the user asked for. */
export function deleteCatOutcome(err: unknown): DeleteCatOutcome {
  const status = statusOf(err);
  if (status === 404) return { kind: "gone" };
  if (status === 409) return { kind: "error", message: "A house keeps at least one cat." };
  return { kind: "error", message: "Couldn't delete. Try again." };
}
