/**
 * Hunger levels (spec §1.6). r = age / hungryAfter. Six levels, the
 * last two past the interval so a forgotten cat escalates visibly.
 * firmware/src/domain/Hunger.h mirrors this and both assert
 * fixtures/hunger-vectors.json.
 */
export type HungerLevel = "fed" | "content" | "peckish" | "hungry" | "very_hungry" | "starving";

export const HUNGER_ORDER: readonly HungerLevel[] = ["fed", "content", "peckish", "hungry", "very_hungry", "starving"];

/** A feeding counts as "just fed" for this long. Assumes hungryAfterSec ≥ 3600
 * (the schema minimum), so the window never swallows the whole interval. */
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
  // A corrupt interval (0, negative, NaN) must never read as content: it
  // would divide to NaN/0 and every comparison below would pick "fed" or
  // "starving" by accident.
  if (!(hungryAfterSec > 0)) return { level: "starving", ratio: Number.POSITIVE_INFINITY, ageSec };
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

/**
 * Semantic colour token per level (webapp/src/styles/tokens/semantic.css).
 * Spec §1.6 has "hungry" orange, not red; the token layer only has
 * good/warn/danger, so hungry shares warn with peckish and danger starts at
 * very_hungry. No `default`: a new level must fail to compile here.
 */
export function levelColor(level: HungerLevel): "good" | "warn" | "danger" {
  switch (level) {
    case "fed":
    case "content":
      return "good";
    case "peckish":
    case "hungry":
      return "warn";
    case "very_hungry":
    case "starving":
      return "danger";
  }
}
