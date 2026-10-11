import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AvatarPoseSchema, type HungerLevel } from "@feedme2/shared";
import { describe, expect, it } from "vitest";
import { AVATAR_POSES, LEVEL_LABELS, POSE_LABELS, poseForLevel, type Pose } from "./pose.ts";

const LEVELS: HungerLevel[] = ["fed", "content", "peckish", "hungry", "very_hungry", "starving"];
const EXPECTED: Record<Exclude<HungerLevel, "content">, Pose> = { fed: "C4", peckish: "A2", hungry: "B2", very_hungry: "B4", starving: "C3" };
const pngFor = (pose: Pose) => fileURLToPath(new URL(`../../public/cats/${pose}.png`, import.meta.url));

describe("poseForLevel (spec §1.6)", () => {
  const cases = AvatarPoseSchema.options.flatMap((avatar) => LEVELS.map((level) => [avatar, level] as const));

  it.each(cases)("avatar %s at level %s", (avatar, level) => {
    expect(poseForLevel(level, avatar)).toBe(level === "content" ? avatar : EXPECTED[level]);
  });

  it.each(cases)("avatar %s at level %s has a rendered mask on disk", (avatar, level) => {
    // A pose with no PNG would render an invisible cat with no error anywhere.
    expect(existsSync(pngFor(poseForLevel(level, avatar)))).toBe(true);
  });
});

describe("labels", () => {
  it("names every level and every one of the 12 poses", () => {
    expect(Object.keys(LEVEL_LABELS).sort()).toEqual([...LEVELS].sort());
    expect(Object.keys(POSE_LABELS)).toHaveLength(12);
    for (const label of [...Object.values(LEVEL_LABELS), ...Object.values(POSE_LABELS)]) expect(label.length).toBeGreaterThan(0);
  });

  it("AVATAR_POSES mirrors the shared schema", () => {
    expect(AVATAR_POSES).toEqual(AvatarPoseSchema.options);
  });
});
