/**
 * Pure scale observation and bowl-transition domain.
 *
 * A food addition is NOT a feeding or food consumption. All masses are integer
 * milligrams. The device is responsible for calibration and stable sampling.
 * This module makes no assumptions about ADC units or the wall clock.
 */
import { z } from "zod";

export const ScaleMassMgSchema = z.number().int().min(0).max(1_000_000);
export const ScaleObservationSchema = z.object({
    id: z.string().uuid(),
    deviceId: z.string().regex(/^[0-9a-f]{32}$/),
    sequence: z.number().int().nonnegative(),
    observedAt: z.number().int().nonnegative(),
    receivedAt: z.number().int().nonnegative().optional(),
    calibrationRevision: z.number().int().positive(),
    grossMg: ScaleMassMgSchema,
    stable: z.boolean(),
}).strict();
export type ScaleObservation = z.infer<typeof ScaleObservationSchema>;

export const BowlProfileSchema = z.object({
    id: z.string().uuid(),
    emptyMassMg: ScaleMassMgSchema,
    toleranceMg: z.number().int().min(0).max(100_000),
    calibrationRevision: z.number().int().positive(),
}).strict();
export type BowlProfile = z.infer<typeof BowlProfileSchema>;

export type ScaleTransition =
    | { kind: "none" }
    | { kind: "lifted"; before: ScaleObservation }
    | { kind: "returned"; before: ScaleObservation; after: ScaleObservation; deltaMg: number; needsReview: boolean; reason?: string };

export type ScaleState =
    | { kind: "empty" }
    | { kind: "present"; last: ScaleObservation; verifiedBowlProfileId?: string }
    | { kind: "lifted"; before: ScaleObservation; verifiedBowlProfileId?: string }
    | { kind: "fault"; reason: string };

export const INITIAL_SCALE_STATE: ScaleState = { kind: "empty" };

/**
 * Called only with a stable, calibrated observation. Presence detection and
 * sensor fault detection belong to the hardware sampling layer.
 *
 * A mismatch in calibration revision or verified bowl profile is reviewable.
 * The caller may provide verifiedBowlProfileId only when bowl identity was
 * independently confirmed; comparing a full bowl to empty mass is NOT enough.
 * Without verified identity, every return needs review. A negative delta is
 * NOT food added. The caller must not create a feeding from it.
 */
export function advanceScale(
    state: ScaleState,
    input: { kind: "present"; observation: ScaleObservation; verifiedBowlProfileId?: string } | { kind: "absent" } | { kind: "fault"; reason: string },
): { state: ScaleState; transition: ScaleTransition } {
    const none: ScaleTransition = { kind: "none" };
    if (input.kind === "fault") {
        return { state: { kind: "fault", reason: input.reason }, transition: none };
    }
    if (input.kind === "absent") {
        if (state.kind === "present") {
            return { state: { kind: "lifted", before: state.last, ...(state.verifiedBowlProfileId ? { verifiedBowlProfileId: state.verifiedBowlProfileId } : {}) }, transition: { kind: "lifted", before: state.last } };
        }
        return { state: state.kind === "lifted" ? state : INITIAL_SCALE_STATE, transition: none };
    }
    const after = ScaleObservationSchema.parse(input.observation);
    if (!after.stable) {
        throw new Error("advanceScale requires a stable observation");
    }
    if (input.verifiedBowlProfileId !== undefined) z.string().uuid().parse(input.verifiedBowlProfileId);
    if (state.kind === "lifted") {
        const before = state.before;
        const deltaMg = after.grossMg - before.grossMg;
        const reason = before.calibrationRevision !== after.calibrationRevision
            ? "calibration_changed"
            : deltaMg < 0 ? "food_removed"
            : !state.verifiedBowlProfileId || !input.verifiedBowlProfileId ? "bowl_unverified"
            : state.verifiedBowlProfileId !== input.verifiedBowlProfileId ? "bowl_changed" : undefined;
        return {
            state: { kind: "present", last: after, ...(input.verifiedBowlProfileId ? { verifiedBowlProfileId: input.verifiedBowlProfileId } : {}) },
            transition: { kind: "returned", before, after, deltaMg, needsReview: reason !== undefined, ...(reason ? { reason } : {}) },
        };
    }
    return { state: { kind: "present", last: after, ...(input.verifiedBowlProfileId ? { verifiedBowlProfileId: input.verifiedBowlProfileId } : {}) }, transition: none };
}

/** Compares gross mass with an explicitly registered empty bowl. */
export function matchesEmptyBowl(observation: ScaleObservation, profile: BowlProfile): boolean {
    if (!observation.stable || observation.calibrationRevision !== profile.calibrationRevision) return false;
    return Math.abs(observation.grossMg - profile.emptyMassMg) <= profile.toleranceMg;
}
