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

/** "40", "1.5", "1/3", "1 1/2", "¼" → units; null when not positive or unparsable. */
export function parseEnteredValue(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  let total = 0;
  for (const part of t.split(/\s+/)) {
    if (part in FRACTION_CHARS) { total += FRACTION_CHARS[part]!; continue; }
    const frac = /^(\d+)\/(\d+)$/.exec(part);
    if (frac) {
      const den = Number(frac[2]);
      if (den === 0) return null;
      total += Number(frac[1]) / den;
      continue;
    }
    if (!/^\d+(\.\d+)?$/.test(part)) return null;
    total += Number(part);
  }
  return total > 0 ? total : null;
}

function unitMg(unit: FoodUnit, canSizeMg: number): number {
  switch (unit) {
    case "g": return 1000;
    case "oz": return MG_PER_OZ;
    case "can": return canSizeMg;
  }
}

export function toMg(value: number, unit: FoodUnit, canSizeMg: number): number {
  return Math.round(value * unitMg(unit, canSizeMg));
}

export function fromMg(mg: number, unit: FoodUnit, canSizeMg: number): number {
  return mg / unitMg(unit, canSizeMg);
}

/** Nearest glyph when the fractional part is within 2% of one, else null. */
function fractionGlyph(frac: number): string | null {
  for (const [v, glyph] of FRACTION_GLYPHS) if (Math.abs(frac - v) < 0.02) return glyph;
  return null;
}

/** Strips trailing zeros of a decimal; integers like "10" are left alone. */
function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export function formatAmount(mg: number, unit: FoodUnit, canSizeMg: number): string {
  const v = fromMg(mg, unit, canSizeMg);
  if (unit === "g") return `${Math.round(v)} g`;
  if (unit === "oz") return `${trimZeros(v.toFixed(2))} oz`;
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  const glyph = frac < 0.02 ? "" : fractionGlyph(frac);
  if (glyph === null) return `${trimZeros(v.toFixed(2))} can`;
  const text = whole === 0 ? glyph : `${whole}${glyph}`;
  return `${text} can`;
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
    case "g": return s.gramStep * 1000;
    case "oz": return Math.round((s.ozStepHundredths / 100) * MG_PER_OZ);
    case "can": {
      const den = Number(s.canFractionStep.split("/")[1]);
      return Math.round(s.canSizeMg / den);
    }
  }
}

export function snapToStep(mg: number, step: number): number {
  return Math.max(step, Math.round(mg / step) * step);
}
