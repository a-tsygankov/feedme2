import { describe, expect, it } from "vitest";
import { msToNextTick } from "./use-now.ts";

describe("msToNextTick", () => {
  it("lands on the next :00 / :30 boundary", () => {
    const minute = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(msToNextTick(minute + 1_000)).toBe(29_000);
    expect(msToNextTick(minute + 29_999)).toBe(1);
    expect(msToNextTick(minute + 31_000)).toBe(29_000);
  });
  it("exactly on a boundary waits a full period, never 0 (no spin)", () => {
    expect(msToNextTick(Date.UTC(2026, 0, 1, 12, 0, 30))).toBe(30_000);
  });
});
