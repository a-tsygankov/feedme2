import type { Cat, FeedingCreate, FoodUnit, StepSettings } from "@feedme2/shared";
import { textForMg } from "./amount-stepper.ts";

interface BuildArgs {
  cats: Cat[];
  /** undefined = every cat ("Feed all"). */
  catId: string | undefined;
  /** The stepper's amount; used for a single cat, and as the fallback for a cat without a default. */
  mg: number;
  fedAt: number;
  unit: FoodUnit;
  settings: StepSettings;
  note: string;
  /** Id for a cat's item. The sheet hands out the same id on every call so a retry after a failed submit is idempotent. */
  ids: (catId: string) => string;
}

/**
 * Incident: "All cats" computed enteredUnit/enteredValue once, from the shared stepper amount, and stamped it on
 * every item, so a cat whose own default differed was stored as e.g. 60 g with enteredValue "40". The entered text is
 * derived per item from the item's own amount.
 */
export function buildFeedItems({ cats, catId, mg, fedAt, unit, settings, note, ids }: BuildArgs): FeedingCreate[] {
  const trimmed = note.trim();
  return cats
    .filter((c) => catId === undefined || c.id === catId)
    .map((c) => {
      const amountMg = catId === undefined ? (c.defaultAmountMg ?? mg) : mg;
      const { enteredUnit, enteredValue } = textForMg(amountMg, unit, settings);
      return { id: ids(c.id), catId: c.id, fedAt, amountMg, enteredUnit, enteredValue, ...(trimmed ? { note: trimmed } : {}) };
    });
}

/** datetime-local wants local wall-clock time, which toISOString() (UTC) would shift. Minute precision. */
export function localInputValue(ms: number): string {
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** A picked time wins; otherwise "N minutes ago". Called from submit(), not render, so "Now" means the tap. */
export function fedAtFrom({ customTime, agoMin, now }: { customTime: string; agoMin: number; now: number }): number {
  return customTime ? new Date(customTime).getTime() : now - agoMin * 60_000;
}

/** Clock skew between phone and picker is tolerated; a feeding in the future would pin the ring at "just fed". */
export const FUTURE_TOLERANCE_MS = 60_000;

export function timeProblem(fedAt: number, now: number): string | null {
  if (Number.isNaN(fedAt)) return "Pick a valid time.";
  if (fedAt > now + FUTURE_TOLERANCE_MS) return "That time is in the future.";
  return null;
}
