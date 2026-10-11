import { describe, expect, it } from "vitest";
import { tzOffsetMin } from "../src/time.ts";

describe("tzOffsetMin", () => {
  it("knows DST and the sign convention (east positive)", () => {
    expect(tzOffsetMin("America/New_York", Date.UTC(2026, 0, 15, 12))).toBe(-300);
    expect(tzOffsetMin("America/New_York", Date.UTC(2026, 6, 15, 12))).toBe(-240);
    expect(tzOffsetMin("Asia/Kolkata", Date.UTC(2026, 0, 15, 12))).toBe(330);
    expect(tzOffsetMin("UTC", Date.UTC(2026, 0, 15, 12))).toBe(0);
  });
  it("falls back to 0 for garbage", () => {
    expect(tzOffsetMin("Not/AZone", Date.now())).toBe(0);
  });
});
