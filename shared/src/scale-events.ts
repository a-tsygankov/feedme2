/**
 * Device-to-cloud scale event outbox protocol.
 * These events are observations, never manual feedings.
 * The authenticated device ID, house ID and pairing token ID are server-derived.
 */
import { z } from "zod";
import { ScaleMassMgSchema } from "./scale.ts";

const eventBase = z.object({
    id: z.string().uuid(),
    /** Persisted by firmware across reboots; scoped to the pairing epoch. */
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    observedAt: z.number().int().nonnegative().max(4_102_444_800_000),
    calibrationRevision: z.number().int().positive().max(2_147_483_647),
});

export const ScaleEventSchema = z.discriminatedUnion("kind", [
    eventBase.extend({ kind: z.literal("stable_weight"), grossMg: ScaleMassMgSchema }).strict(),
    eventBase.extend({ kind: z.literal("bowl_removed") }).strict(),
    eventBase.extend({ kind: z.literal("bowl_returned"), grossMg: ScaleMassMgSchema }).strict(),
    eventBase.extend({
        kind: z.literal("sensor_fault"),
        code: z.enum(["adc_timeout", "sensor_disconnected", "overload", "calibration_invalid"]),
    }).strict(),
]);

export type ScaleEvent = z.infer<typeof ScaleEventSchema>;

export const DeviceScaleEventsBodySchema = z.array(ScaleEventSchema).min(1).max(50);
export const DeviceScaleEventsResponseSchema = z.object({
    /** IDs inserted for the first time. A replay returns an empty array. */
    accepted: z.array(z.string().uuid()),
    now: z.number().int().nonnegative(),
});

export type DeviceScaleEventsResponse = z.infer<typeof DeviceScaleEventsResponseSchema>;
