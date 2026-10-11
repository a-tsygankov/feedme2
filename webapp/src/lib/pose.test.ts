import { describe, expect, it } from "vitest";
import { poseForLevel } from "./pose.ts";

describe("poseForLevel (spec §1.6)", () => {
  it("maps each level to its pose, using the avatar when content", () => {
    expect(poseForLevel("fed", "A1")).toBe("C4");
    expect(poseForLevel("content", "A1")).toBe("A1");
    expect(poseForLevel("content", "B1")).toBe("B1");
    expect(poseForLevel("peckish", "A1")).toBe("A2");
    expect(poseForLevel("hungry", "A1")).toBe("B2");
    expect(poseForLevel("very_hungry", "A1")).toBe("B4");
    expect(poseForLevel("starving", "A1")).toBe("C3");
  });
});
