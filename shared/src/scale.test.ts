import { describe, expect, it } from "vitest";
import { advanceScale, INITIAL_SCALE_STATE, matchesEmptyBowl, ScaleObservationSchema, type ScaleObservation } from "./scale.ts";

const base: ScaleObservation = {
    id: "7b81277a-f0e7-4eb9-bd52-59f8f2527a01",
    deviceId: "0123456789abcdef0123456789abcdef",
    sequence: 1,
    observedAt: 1000,
    calibrationRevision: 1,
    grossMg: 125_000,
    stable: true,
};

describe("scale domain", () => {
    it("detects a positive addition only after a lift and stable return", () => {
        const present = advanceScale(INITIAL_SCALE_STATE, { kind: "present", observation: base });
        expect(present.transition.kind).toBe("none");
        const lifted = advanceScale(present.state, { kind: "absent" });
        expect(lifted.transition.kind).toBe("lifted");
        const returned = advanceScale(lifted.state, { kind: "present", observation: { ...base, sequence: 2, grossMg: 155_000 } });
        expect(returned.transition).toMatchObject({ kind: "returned", deltaMg: 30_000, needsReview: true, reason: "bowl_unverified" });
    });

    it("accepts an unreviewed positive delta only for the same independently verified bowl", () => {
        const bowl = base.id;
        const present = advanceScale(INITIAL_SCALE_STATE, { kind: "present", observation: base, verifiedBowlProfileId: bowl });
        const lifted = advanceScale(present.state, { kind: "absent" });
        const returned = advanceScale(lifted.state, { kind: "present", observation: { ...base, sequence: 2, grossMg: 155_000 }, verifiedBowlProfileId: bowl });
        expect(returned.transition).toMatchObject({ kind: "returned", deltaMg: 30_000, needsReview: false });
    });

    it("requires review when a different bowl is returned", () => {
        const present = advanceScale(INITIAL_SCALE_STATE, { kind: "present", observation: base, verifiedBowlProfileId: base.id });
        const lifted = advanceScale(present.state, { kind: "absent" });
        const returned = advanceScale(lifted.state, {
            kind: "present", observation: { ...base, sequence: 2, grossMg: 155_000 },
            verifiedBowlProfileId: "a81277a1-f0e7-4eb9-bd52-59f8f2527a02",
        });
        expect(returned.transition).toMatchObject({ kind: "returned", needsReview: true, reason: "bowl_changed" });
    });

    it("does not mistake negative delta for food added", () => {
        const lifted = advanceScale({ kind: "present", last: base }, { kind: "absent" });
        const result = advanceScale(lifted.state, { kind: "present", observation: { ...base, grossMg: 100_000 } });
        expect(result.transition).toMatchObject({ kind: "returned", deltaMg: -25_000, needsReview: true, reason: "food_removed" });
    });

    it("flags changed calibration for review", () => {
        const result = advanceScale({ kind: "lifted", before: base }, { kind: "present", observation: { ...base, calibrationRevision: 2 } });
        expect(result.transition).toMatchObject({ kind: "returned", needsReview: true, reason: "calibration_changed" });
    });

    it("rejects unstable observations and impossible weights", () => {
        expect(() => advanceScale(INITIAL_SCALE_STATE, { kind: "present", observation: { ...base, stable: false } })).toThrow();
        expect(ScaleObservationSchema.safeParse({ ...base, grossMg: -1 }).success).toBe(false);
        expect(ScaleObservationSchema.safeParse({ ...base, grossMg: 1_000_001 }).success).toBe(false);
    });

    it("does not turn an empty state into a phantom addition", () => {
        expect(advanceScale(INITIAL_SCALE_STATE, { kind: "absent" }).transition.kind).toBe("none");
    });

    it("matches a bowl only within tolerance and the same calibration", () => {
        const profile = { id: base.id, emptyMassMg: 124_000, toleranceMg: 1_000, calibrationRevision: 1 };
        expect(matchesEmptyBowl(base, profile)).toBe(true);
        expect(matchesEmptyBowl({ ...base, grossMg: 125_001 }, profile)).toBe(false);
        expect(matchesEmptyBowl({ ...base, calibrationRevision: 2 }, profile)).toBe(false);
    });

    it("enters fault without emitting a food addition", () => {
        const result = advanceScale({ kind: "present", last: base }, { kind: "fault", reason: "adc_timeout" });
        expect(result.state).toEqual({ kind: "fault", reason: "adc_timeout" });
        expect(result.transition.kind).toBe("none");
    });
});
