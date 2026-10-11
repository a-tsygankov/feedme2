import { describe, expect, it } from "vitest";
import vectors from "../../fixtures/hunger-vectors.json";
import { FED_WINDOW_SEC, HUNGER_ORDER, hungerState, levelColor, type HungerLevel } from "./hunger.ts";

describe("hunger (pinned by fixtures/hunger-vectors.json)", () => {
  it("constants match the fixture", () => {
    expect(FED_WINDOW_SEC).toBe(vectors.fedWindowSec);
  });
  it("every vector yields the expected level, ratio and age", () => {
    for (const c of vectors.cases) {
      const s = hungerState(c.nowMs, c.lastFedAtMs, c.hungryAfterSec);
      expect(s.level, JSON.stringify(c)).toBe(c.level as HungerLevel);
      if (c.ratio === null) expect(s.ratio).toBe(Number.POSITIVE_INFINITY);
      else expect(s.ratio, JSON.stringify(c)).toBeCloseTo(c.ratio, 3);
      if (c.ageSec === null) expect(s.ageSec).toBe(Number.POSITIVE_INFINITY);
      else expect(s.ageSec, JSON.stringify(c)).toBeCloseTo(c.ageSec, 6);
    }
  });
  it("a future lastFedAt (phone clock ahead) clamps to age 0 and reads as fed", () => {
    const s = hungerState(1_000_000, 1_600_000, 18000);
    expect(s.ageSec).toBe(0);
    expect(s.level).toBe("fed");
  });
  it("a corrupt interval reads as starving, never content", () => {
    for (const bad of [0, -1, Number.NaN]) {
      const s = hungerState(1_000_000_000, 999_000_000, bad);
      expect(s.level, String(bad)).toBe("starving");
      expect(s.ratio).toBe(Number.POSITIVE_INFINITY);
      expect(s.ageSec).toBe(1000);
    }
  });
  it("HUNGER_ORDER lists every level exactly once", () => {
    const levels: HungerLevel[] = ["fed", "content", "peckish", "hungry", "very_hungry", "starving"];
    expect([...HUNGER_ORDER].sort()).toEqual([...levels].sort());
    expect(new Set(HUNGER_ORDER).size).toBe(HUNGER_ORDER.length);
  });
  it("levels never improve as the ratio grows", () => {
    const interval = 18000;
    let prev = 0;
    for (let ageSec = 0; ageSec <= interval * 2; ageSec += 60) {
      const s = hungerState(1_000_000_000_000, 1_000_000_000_000 - ageSec * 1000, interval);
      const idx = HUNGER_ORDER.indexOf(s.level);
      expect(idx, `age ${ageSec}`).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
    expect(prev).toBe(HUNGER_ORDER.length - 1);
  });
  it("levelColor maps hungry to warn (spec §1.6: orange, not red)", () => {
    expect(levelColor("fed")).toBe("good");
    expect(levelColor("content")).toBe("good");
    expect(levelColor("peckish")).toBe("warn");
    expect(levelColor("hungry")).toBe("warn");
    expect(levelColor("very_hungry")).toBe("danger");
    expect(levelColor("starving")).toBe("danger");
  });
});
