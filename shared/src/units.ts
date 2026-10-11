/**
 * Food amounts (spec §1.5). Canonical storage is integer milligrams;
 * people see and enter grams, ounces or can fractions. This is the ONE
 * TypeScript home for conversions; firmware/src/domain/Units.h mirrors
 * it and both assert fixtures/unit-vectors.json.
 */
import type { CanFractionStep, FoodUnit } from "./api.ts";
export type { CanFractionStep, FoodUnit } from "./api.ts";

export const MG_PER_OZ = 28349.5;
/** 5.5 oz, the standard pet can. */
export const DEFAULT_CAN_MG = 155922;

const FRACTION_CHARS: Record<string, number> = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
export const FRACTION_GLYPHS: Array<[number, string]> = [
  [1 / 4, "¼"], [1 / 3, "⅓"], [1 / 2, "½"], [2 / 3, "⅔"], [3 / 4, "¾"],
];

/** Sanity cap on a typed amount: nobody feeds a million cans, but a pasted number could. */
const MAX_ENTERED_VALUE = 1_000_000;

/**
 * Typed amount → units; null when not positive, unparsable or above 1,000,000.
 * Accepted forms (after trimming, NBSP → space, whitespace collapsed and a
 * single "," read as ".", for comma-decimal keyboards):
 *   decimal   "40", "1.5", ".5", "5."
 *   fraction  "1/3", "1 1/2"  (the space is REQUIRED between whole and fraction,
 *                              so "11/2" is eleven halves, not 1 and 1/2)
 *   glyph     "¼", "1½", "1 ½"
 * Anything else ("40 50", "1 2", "1/2 1/2") is null: summing loose tokens
 * once let "40 50" read as 90 g.
 */
export function parseEnteredValue(text: string): number | null {
  const t = text.trim().replace(/\u00a0/g, " ").replace(/\s+/g, " ").replace(",", ".");
  let value: number;
  let m: RegExpExecArray | null;
  if (/^(\d+(\.\d*)?|\.\d+)$/.test(t)) {
    value = Number(t);
  } else if ((m = /^(?:(\d+) )?(\d+)\/(\d+)$/.exec(t))) {
    const den = Number(m[3]);
    if (den === 0) return null;
    value = Number(m[1] ?? 0) + Number(m[2]) / den;
  } else if ((m = /^(?:(\d+) ?)?([¼½¾⅓⅔])$/.exec(t))) {
    value = Number(m[1] ?? 0) + FRACTION_CHARS[m[2]!]!;
  } else {
    return null;
  }
  return value > 0 && value <= MAX_ENTERED_VALUE ? value : null;
}

function unitMg(unit: FoodUnit, canSizeMg: number): number {
  switch (unit) {
    case "g": return 1000;
    case "oz": return MG_PER_OZ;
    case "can": return canSizeMg;
  }
}

/** Callers must re-check `> 0` on the result: a parsed 1e-20 rounds to 0 mg. */
export function toMg(value: number, unit: FoodUnit, canSizeMg: number): number {
  return Math.round(value * unitMg(unit, canSizeMg));
}

export function fromMg(mg: number, unit: FoodUnit, canSizeMg: number): number {
  return mg / unitMg(unit, canSizeMg);
}

/** A can fraction within this of a glyph (¼ ⅓ ½ ⅔ ¾) is shown as the glyph. */
export const GLYPH_TOLERANCE = 0.02;

/**
 * Splits a can amount into whole cans and a fraction glyph. glyph "" means
 * "whole only" (fraction under the tolerance), null means "no glyph fits".
 * The tolerance is asymmetric near wholes (1.01 → "1 can" but 0.99 →
 * "0.99 can"); that is accepted, not a bug.
 */
export function canParts(v: number): { whole: number; glyph: string | null } {
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  if (frac < GLYPH_TOLERANCE) return { whole, glyph: "" };
  for (const [gv, glyph] of FRACTION_GLYPHS) if (Math.abs(frac - gv) < GLYPH_TOLERANCE) return { whole, glyph };
  return { whole, glyph: null };
}

/** Strips trailing zeros of a decimal; integers like "10" are left alone. */
function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export function formatAmount(mg: number, unit: FoodUnit, canSizeMg: number): string {
  if (!Number.isFinite(mg)) return "—";
  const v = fromMg(mg, unit, canSizeMg);
  if (unit === "g") return `${Math.round(v)} g`;
  if (unit === "oz") return `${trimZeros(v.toFixed(2))} oz`;
  const { whole, glyph } = canParts(v);
  // Under one glyph step with nothing whole to show, "" would render a bare
  // " can"; a tiny amount reads as a decimal instead.
  if (glyph === null || (glyph === "" && whole === 0)) return `${trimZeros(v.toFixed(2))} can`;
  return `${whole === 0 ? glyph : `${whole}${glyph}`} can`;
}

export interface StepSettings {
  gramStep: number;
  ozStepHundredths: number;
  canFractionStep: CanFractionStep;
  canSizeMg: number;
}

/** One knob detent / one stepper tap, in mg, for the house's unit. */
export function stepMg(unit: FoodUnit, s: StepSettings): number {
  switch (unit) {
    case "g": return Math.round(s.gramStep * 1000);
    case "oz": return Math.round((s.ozStepHundredths / 100) * MG_PER_OZ);
    case "can": {
      const den = Number(s.canFractionStep.split("/")[1]);
      return Math.round(s.canSizeMg / den);
    }
  }
}

export function snapToStep(mg: number, step: number): number {
  // NaN must never reach a stored mg: a bad step or amount falls back to one
  // step (or 0 when the step itself is unusable).
  if (!(step > 0) || !Number.isFinite(mg)) return step > 0 ? step : 0;
  return Math.max(step, Math.round(mg / step) * step);
}
