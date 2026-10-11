import type { Cat, HungerLevel } from "@feedme2/shared";

// shared exports AvatarPoseSchema but not its inferred type; derive it from Cat.
type AvatarPose = Cat["avatarPose"];

export type Pose = "A1" | "A2" | "A3" | "A4" | "B1" | "B2" | "B3" | "B4" | "C1" | "C2" | "C3" | "C4";

/** Spec §1.6/§1.7: the cat's own avatar while content, then an escalating pose. */
export function poseForLevel(level: HungerLevel, avatarPose: AvatarPose): Pose {
  switch (level) {
    case "fed": return "C4";
    case "content": return avatarPose;
    case "peckish": return "A2";
    case "hungry": return "B2";
    case "very_hungry": return "B4";
    case "starving": return "C3";
  }
}

export const POSE_LABELS: Record<AvatarPose, string> = {
  A1: "Slim sit", A4: "Looking away", B1: "Calm sit", C1: "Front sit", C2: "Alert",
};
