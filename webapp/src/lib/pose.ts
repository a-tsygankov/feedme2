import { AvatarPoseSchema, type AvatarPose, type HungerLevel } from "@feedme2/shared";

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

/** The poses a cat can pick as its avatar (the shared schema is the source of truth). */
export const AVATAR_POSES = AvatarPoseSchema.options;

/** Screen-reader names for the hunger level; the ring is the only place the level is conveyed without colour. */
export const LEVEL_LABELS: Record<HungerLevel, string> = {
  fed: "Fed", content: "Content", peckish: "Peckish", hungry: "Hungry", very_hungry: "Very hungry", starving: "Starving",
};

export const POSE_LABELS: Record<Pose, string> = {
  A1: "Slim sit", A2: "Pacing", A3: "Prowling", A4: "Looking away",
  B1: "Calm sit", B2: "Begging", B3: "Grooming", B4: "Pleading",
  C1: "Front sit", C2: "Alert", C3: "Climbing", C4: "Content",
};
