/**
 * Hunger levels (spec §1.6). r = age / hungryAfter. Six levels, the
 * last two past the interval so a forgotten cat escalates visibly.
 * firmware/src/domain/Hunger.h mirrors this and both assert
 * fixtures/hunger-vectors.json.
 */
export type HungerLevel = "fed" | "content" | "peckish" | "hungry" | "very_hungry" | "starving";

export const HUNGER_ORDER: readonly HungerLevel[] = ["fed", "content", "peckish", "hungry", "very_hungry", "starving"];

/** A feeding counts as "just fed" for this long. */
export const FED_WINDOW_SEC = 900;

export interface HungerState {
  level: HungerLevel;
  /** age / hungryAfter, clamped ≥ 0; Infinity when never fed. */
  ratio: number;
  /** Seconds since the last feeding, clamped ≥ 0; Infinity when never fed. */
  ageSec: number;
}

export function hungerState(nowMs: number, lastFedAtMs: number | null, hungryAfterSec: number): HungerState {
  if (lastFedAtMs === null) {
    return { level: "starving", ratio: Number.POSITIVE_INFINITY, ageSec: Number.POSITIVE_INFINITY };
  }
  // A phone whose clock runs ahead of the server produces a feeding in
  // the future; treat it as "just now" rather than a negative age.
  const ageSec = Math.max(0, (nowMs - lastFedAtMs) / 1000);
  const ratio = ageSec / hungryAfterSec;
  let level: HungerLevel;
  if (ageSec < FED_WINDOW_SEC) level = "fed";
  else if (ratio < 0.5) level = "content";
  else if (ratio < 0.75) level = "peckish";
  else if (ratio < 1.0) level = "hungry";
  else if (ratio < 1.5) level = "very_hungry";
  else level = "starving";
  return { level, ratio, ageSec };
}

/** Semantic colour token per level (webapp/src/styles/tokens/semantic.css). */
export function levelColor(level: HungerLevel): "good" | "warn" | "danger" {
  switch (level) {
    case "fed":
    case "content":
      return "good";
    case "peckish":
      return "warn";
    default:
      return "danger";
  }
}
