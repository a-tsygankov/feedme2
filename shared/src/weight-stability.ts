/**
 * Reference implementation of a stable-weight detector.
 *
 * No automatic tare, no food-addition inference, and no hard-coded
 * thresholds: hardware bench measurements must provide the configuration.
 * This pure TypeScript implementation is a contract for native C++ parity.
 */
export type WeightSample = {
    /** Monotonic device time in milliseconds (not UTC). */
    atMs: number;
    grossMg: number;
    calibrationRevision: number;
};

export type StabilityConfig = {
    minSamples: number;
    minDwellMs: number;
    maxSpreadMg: number;
    maxSampleGapMs: number;
    /** Software guard only; does not replace mechanical overload stops. */
    maxGrossMg: number;
};

export type StabilityResult =
    | { status: "settling"; sampleCount: number; spreadMg: number }
    | { status: "stable"; grossMg: number; calibrationRevision: number; sinceMs: number; sampleCount: number; spreadMg: number }
    | { status: "fault"; code: "invalid_sample" | "overload" };

const MAX_BUFFER = 256;

function checkInt(name: string, n: number, min: number, max: number): void {
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new RangeError(`${name} out of range`);
}

export class WeightStabilityEstimator {
    private samples: number[] = [];
    private firstAtMs: number | null = null;
    private lastAtMs: number | null = null;
    private revision: number | null = null;
    private min = 0;
    private max = 0;

    constructor(private readonly config: StabilityConfig) {
        checkInt("minSamples", config.minSamples, 2, MAX_BUFFER);
        checkInt("minDwellMs", config.minDwellMs, 0, 60_000);
        checkInt("maxSpreadMg", config.maxSpreadMg, 0, 1_000_000);
        checkInt("maxSampleGapMs", config.maxSampleGapMs, 1, 60_000);
        checkInt("maxGrossMg", config.maxGrossMg, 1, 1_000_000);
    }

    reset(): void {
        this.samples = [];
        this.firstAtMs = null;
        this.lastAtMs = null;
        this.revision = null;
        this.min = 0;
        this.max = 0;
    }

    add(sample: WeightSample): StabilityResult {
        checkInt("atMs", sample.atMs, 0, Number.MAX_SAFE_INTEGER);
        checkInt("calibrationRevision", sample.calibrationRevision, 1, 2_147_483_647);
        if (!Number.isSafeInteger(sample.grossMg) || sample.grossMg < 0) {
            this.reset();
            return { status: "fault", code: "invalid_sample" };
        }
        if (sample.grossMg > this.config.maxGrossMg) {
            this.reset();
            return { status: "fault", code: "overload" };
        }
        if (this.lastAtMs !== null && sample.atMs < this.lastAtMs) {
            throw new RangeError("samples must arrive in monotonic time order");
        }
        const interrupted = this.lastAtMs !== null && sample.atMs - this.lastAtMs > this.config.maxSampleGapMs;
        const recalibrated = this.revision !== null && sample.calibrationRevision !== this.revision;
        const outsideSpread = this.samples.length > 0 &&
            Math.max(this.max, sample.grossMg) - Math.min(this.min, sample.grossMg) > this.config.maxSpreadMg;
        if (interrupted || recalibrated || outsideSpread || this.samples.length === 0) {
            this.samples = [sample.grossMg];
            this.firstAtMs = sample.atMs;
            this.min = sample.grossMg;
            this.max = sample.grossMg;
        } else {
            this.samples.push(sample.grossMg);
            if (this.samples.length > MAX_BUFFER) this.samples.shift();
            this.min = Math.min(this.min, sample.grossMg);
            this.max = Math.max(this.max, sample.grossMg);
        }
        this.lastAtMs = sample.atMs;
        this.revision = sample.calibrationRevision;
        const spreadMg = this.max - this.min;
        if (this.samples.length < this.config.minSamples || sample.atMs - this.firstAtMs! < this.config.minDwellMs) {
            return { status: "settling", sampleCount: this.samples.length, spreadMg };
        }
        const sorted = [...this.samples].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        const grossMg = sorted.length % 2 === 1
            ? sorted[middle]!
            : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
        return {
            status: "stable",
            grossMg,
            calibrationRevision: sample.calibrationRevision,
            sinceMs: this.firstAtMs!,
            sampleCount: this.samples.length,
            spreadMg,
        };
    }
}
