import { canParts, fromMg, snapToStep, stepMg, type FoodUnit, type StepSettings } from "@feedme2/shared";

export function stepAmount(mg: number, dir: 1 | -1, unit: FoodUnit, s: StepSettings): number {
  const step = stepMg(unit, s);
  return snapToStep(mg + dir * step, step);
}

const GLYPH_TEXT: Record<string, string> = { "¼": "1/4", "⅓": "1/3", "½": "1/2", "⅔": "2/3", "¾": "3/4" };

/** What to record as enteredUnit/enteredValue for a stepped amount. */
export function textForMg(mg: number, unit: FoodUnit, s: StepSettings): { enteredUnit: FoodUnit; enteredValue: string } {
  const v = fromMg(mg, unit, s.canSizeMg);
  if (unit === "g") return { enteredUnit: "g", enteredValue: String(Math.round(v)) };
  if (unit === "oz") return { enteredUnit: "oz", enteredValue: String(Number(v.toFixed(2))) };
  // The whole/fraction split lives in shared (canParts) so display and entry never disagree.
  const { whole, glyph } = canParts(v);
  if (glyph === "") return { enteredUnit: "can", enteredValue: String(whole) };
  const fracText = glyph === null ? undefined : GLYPH_TEXT[glyph];
  if (fracText === undefined) return { enteredUnit: "can", enteredValue: String(Number(v.toFixed(2))) };
  return { enteredUnit: "can", enteredValue: whole === 0 ? fracText : `${whole} ${fracText}` };
}
