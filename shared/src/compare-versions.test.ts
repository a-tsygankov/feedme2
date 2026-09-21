import { describe, expect, it } from "vitest";
import { compareVersions } from "./compare-versions.ts";

const sgn = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

describe("compareVersions", () => {
  it("equal", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("numeric ordering beats lexicographic", () => {
    expect(sgn(compareVersions("1.10.0", "1.2.0"))).toBe(1);
    expect(sgn(compareVersions("0.9.0", "0.10.0"))).toBe(-1);
  });
  it("missing segments are zero", () => {
    expect(compareVersions("1.4", "1.4.0")).toBe(0);
    expect(sgn(compareVersions("1.4", "1.4.1"))).toBe(-1);
  });
  it("prerelease sorts before release", () => {
    expect(sgn(compareVersions("1.4.2-rc1", "1.4.2"))).toBe(-1);
    expect(sgn(compareVersions("1.4.2", "1.4.2-rc1"))).toBe(1);
  });
});
