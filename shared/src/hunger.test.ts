import { describe, expect, it } from "vitest";
import vectors from "../../fixtures/hunger-vectors.json";
import { FED_WINDOW_SEC, hungerState, type HungerLevel } from "./hunger.ts";

describe("hunger (pinned by fixtures/hunger-vectors.json)", () => {
  it("constants match the fixture", () => {
    expect(FED_WINDOW_SEC).toBe(vectors.fedWindowSec);
  });
  it("every vector yields the expected level and ratio", () => {
    for (const c of vectors.cases) {
      const s = hungerState(c.nowMs, c.lastFedAtMs, c.hungryAfterSec);
      expect(s.level, JSON.stringify(c)).toBe(c.level as HungerLevel);
      if (c.ratio === null) expect(s.ratio).toBe(Number.POSITIVE_INFINITY);
      else expect(s.ratio, JSON.stringify(c)).toBeCloseTo(c.ratio, 3);
    }
  });
  it("a future lastFedAt (phone clock ahead) clamps to age 0 and reads as fed", () => {
    const s = hungerState(1_000_000, 1_600_000, 18000);
    expect(s.ageSec).toBe(0);
    expect(s.level).toBe("fed");
  });
});
