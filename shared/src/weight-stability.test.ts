import { describe, expect, it } from "vitest";
import { WeightStabilityEstimator, type StabilityConfig } from "./weight-stability.ts";

const config: StabilityConfig = {
    minSamples: 3,
    minDwellMs: 2000,
    maxSpreadMg: 100,
    maxSampleGapMs: 1500,
    maxGrossMg: 900_000,
};
const sample = (atMs: number, grossMg = 125_000, calibrationRevision = 1) =>
    ({ atMs, grossMg, calibrationRevision });

describe("WeightStabilityEstimator", () => {
    it("waits for both sample count and dwell time", () => {
        const d = new WeightStabilityEstimator(config);
        expect(d.add(sample(0)).status).toBe("settling");
        expect(d.add(sample(1000)).status).toBe("settling");
        expect(d.add(sample(2000))).toMatchObject({ status: "stable", grossMg: 125_000, sampleCount: 3, sinceMs: 0 });
    });

    it("returns the median, not a mean distorted by noise", () => {
        const d = new WeightStabilityEstimator(config);
        d.add(sample(0, 125_000));
        d.add(sample(1000, 125_080));
        expect(d.add(sample(2000, 125_000))).toMatchObject({ status: "stable", grossMg: 125_000, spreadMg: 80 });
    });

    it("restarts the stability window when a bowl weight changes", () => {
        const d = new WeightStabilityEstimator(config);
        d.add(sample(0));
        d.add(sample(1000));
        expect(d.add(sample(2000)).status).toBe("stable");
        expect(d.add(sample(2500, 155_000))).toMatchObject({ status: "settling", sampleCount: 1 });
        d.add(sample(3500, 155_000));
        expect(d.add(sample(4500, 155_000))).toMatchObject({ status: "stable", grossMg: 155_000, sinceMs: 2500 });
    });

    it("resets after a sample gap", () => {
        const d = new WeightStabilityEstimator(config);
        d.add(sample(0));
        d.add(sample(1000));
        expect(d.add(sample(3000))).toMatchObject({ status: "settling", sampleCount: 1 });
    });

    it("resets when calibration revision changes", () => {
        const d = new WeightStabilityEstimator(config);
        d.add(sample(0));
        d.add(sample(1000));
        expect(d.add(sample(2000, 125_000, 2))).toMatchObject({ status: "settling", sampleCount: 1 });
    });

    it("does not stabilize persistent high-variance readings", () => {
        const d = new WeightStabilityEstimator(config);
        for (let t = 0; t <= 8000; t += 1000) {
            expect(d.add(sample(t, t % 2000 ? 125_200 : 125_000)).status).toBe("settling");
        }
    });

    it("returns a fault for overload and does not reuse the previous window", () => {
        const d = new WeightStabilityEstimator(config);
        d.add(sample(0));
        d.add(sample(1000));
        expect(d.add(sample(2000, 900_001))).toEqual({ status: "fault", code: "overload" });
        expect(d.add(sample(3000))).toMatchObject({ status: "settling", sampleCount: 1 });
    });

    it("rejects invalid mass and backward timestamps", () => {
        const d = new WeightStabilityEstimator(config);
        d.add(sample(1000));
        expect(() => d.add(sample(999))).toThrow(/monotonic/);
        expect(d.add(sample(2000, -1))).toEqual({ status: "fault", code: "invalid_sample" });
        expect(d.add(sample(3000))).toMatchObject({ status: "settling", sampleCount: 1 });
    });

    it("supports explicit reset on sensor power cycle", () => {
        const d = new WeightStabilityEstimator(config);
        d.add(sample(0));
        d.add(sample(1000));
        d.reset();
        expect(d.add(sample(0))).toMatchObject({ status: "settling", sampleCount: 1 });
    });

    it("validates all configuration bounds", () => {
        expect(() => new WeightStabilityEstimator({ ...config, minSamples: 1 })).toThrow();
        expect(() => new WeightStabilityEstimator({ ...config, maxSpreadMg: -1 })).toThrow();
        expect(() => new WeightStabilityEstimator({ ...config, maxSampleGapMs: 0 })).toThrow();
        expect(() => new WeightStabilityEstimator({ ...config, maxGrossMg: 1_000_001 })).toThrow();
    });
});
