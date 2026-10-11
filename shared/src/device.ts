/**
 * Device-facing contracts (spec §3.2–3.3, §5.3). The firmware's JSON
 * parser and tools/device-sim both target these shapes;
 * fixtures/device-state.sample.json is the cross-tier sample.
 */
import { z } from "zod";
import { CatSchema, FeedingCreateSchema, HouseSettingsSchema, LogsUploadBodySchema } from "./api.ts";

export const DEVICE_ID_RE = /^[0-9a-f]{32}$/;
export const DeviceIdSchema = z.string().regex(DEVICE_ID_RE, "32 lowercase hex chars");
export const PAIR_CODE_RE = /^\d{6}$/;
export const PairCodeSchema = z.string().regex(PAIR_CODE_RE, "6 digits");
export const HwModelSchema = z.enum(["crowpanel-1.28", "simulator", "device-sim"]);
export type HwModel = z.infer<typeof HwModelSchema>;
export const FwVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "semver");
export const DeviceNameSchema = z.string().trim().min(1).max(32);

const epochMs = z.number().int().nonnegative().max(4_102_444_800_000);

export const DeviceSchema = z.object({
  id: DeviceIdSchema,
  houseId: z.string(),
  name: z.string(),
  hwModel: HwModelSchema,
  fwVersion: z.string(),
  lastSeenAt: epochMs.nullable(),
  batteryPct: z.number().int().min(0).max(100).nullable(),
  resetReason: z.string().nullable(),
  autoInstall: z.boolean(),
  createdAt: epochMs,
  revokedAt: epochMs.nullable(),
});
export type Device = z.infer<typeof DeviceSchema>;
export const DevicesResponseSchema = z.object({ devices: z.array(DeviceSchema) });

export const DevicePatchSchema = z
  .object({ name: DeviceNameSchema, autoInstall: z.boolean() })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, "empty patch");
export type DevicePatch = z.infer<typeof DevicePatchSchema>;

export const PairStartBodySchema = z.object({ deviceId: DeviceIdSchema, hwModel: HwModelSchema, fwVersion: FwVersionSchema });
export type PairStartBody = z.infer<typeof PairStartBodySchema>;
export const PairStartResponseSchema = z.object({ pairCode: PairCodeSchema, expiresAt: epochMs, pollAfterSec: z.number().int().positive() });
export type PairStartResponse = z.infer<typeof PairStartResponseSchema>;

export const PairCheckBodySchema = z.object({ deviceId: DeviceIdSchema });
export const PairCheckResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("confirmed"), deviceToken: z.string().min(1), houseId: z.string(), houseName: z.string(), deviceName: z.string() }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("unknown") }),
]);
export type PairCheckResponse = z.infer<typeof PairCheckResponseSchema>;

export const PairConfirmBodySchema = z.object({ pairCode: PairCodeSchema, name: DeviceNameSchema.optional() });
export type PairConfirmBody = z.infer<typeof PairConfirmBodySchema>;
export const PairConfirmResponseSchema = z.object({ device: DeviceSchema });

/** What the device renders. A subset of Cat: no houseId/createdAt/modifiedAt. */
export const DeviceStateCatSchema = CatSchema.pick({
  id: true, name: true, color: true, avatarPose: true, hungryAfterSec: true, sortOrder: true,
  defaultAmountMg: true, defaultEnteredUnit: true, defaultEnteredValue: true, lastFedAt: true,
});
export type DeviceStateCat = z.infer<typeof DeviceStateCatSchema>;

export const DeviceStateSchema = z.object({
  house: z.object({
    id: z.string(),
    name: z.string(),
    /** UTC offset of the house timezone at `now`, minutes east of UTC (New York in winter: -300). */
    tzOffsetMin: z.number().int().min(-900).max(900),
    settings: HouseSettingsSchema,
  }),
  device: z.object({ id: DeviceIdSchema, name: z.string() }),
  cats: z.array(DeviceStateCatSchema).max(8),
  /** Server time; the device corrects its clock from this (spec §5.3). */
  now: epochMs,
  syncIntervalSec: z.number().int().positive(),
  sleepTimeoutSec: z.number().int().positive(),
});
export type DeviceState = z.infer<typeof DeviceStateSchema>;

export const DeviceFeedingCreateSchema = FeedingCreateSchema.omit({ note: true }).strict();
export type DeviceFeedingCreate = z.infer<typeof DeviceFeedingCreateSchema>;
export const DeviceFeedingsBodySchema = z.array(DeviceFeedingCreateSchema).min(1).max(100);
export const DeviceFeedingsResponseSchema = z.object({
  accepted: z.array(z.string()),
  /** Ids whose fedAt the server moved into [now − 7 d, now + 5 min] (bad device clock). */
  clamped: z.array(z.string()),
  now: epochMs,
});
export type DeviceFeedingsResponse = z.infer<typeof DeviceFeedingsResponseSchema>;

export const HeartbeatBodySchema = z.object({
  fwVersion: FwVersionSchema,
  batteryPct: z.number().int().min(0).max(100).optional(),
  uptimeSec: z.number().int().nonnegative(),
  resetReason: z.string().max(32),
  freeHeap: z.number().int().nonnegative(),
});
export type HeartbeatBody = z.infer<typeof HeartbeatBodySchema>;
export const HeartbeatResponseSchema = z.object({ now: epochMs });

export const DeviceLogsBodySchema = LogsUploadBodySchema;
