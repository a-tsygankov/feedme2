import { z } from "zod";
import { LogEntrySchema } from "./log.ts";

/** Spec §1.4 — the house's units and device settings. */
export const FoodUnitSchema = z.enum(["g", "oz", "can"]);
export const CanFractionStepSchema = z.enum(["1/4", "1/3", "1/2"]);
/** Spec §1.7 — the five calm poses offered as identities. */
export const AvatarPoseSchema = z.enum(["A1", "A4", "B1", "C1", "C2"]);

export const MAX_CATS = 8;

/** Eight swatches that survive tinting on both themes and on the dark
 * device screen. The first is the default. */
export const CAT_COLORS = [
  "#4CAF50", "#2196F3", "#E91E63", "#8B4513", "#FF9800", "#9C27B0", "#00BCD4", "#607D8B",
] as const;
export const CatColorSchema = z.enum(CAT_COLORS);

const uuid = z.string().uuid();
const epochMs = z.number().int().nonnegative();

export const HouseSettingsSchema = z.object({
  foodUnit: FoodUnitSchema,
  canSizeMg: z.number().int().min(10_000).max(1_000_000),
  canFractionStep: CanFractionStepSchema,
  gramStep: z.union([z.literal(1), z.literal(5), z.literal(10)]),
  ozStepHundredths: z.union([z.literal(25), z.literal(50)]),
  hungryAfterSecDefault: z.number().int().min(3600).max(86_400),
  sleepTimeoutSec: z.number().int().min(60).max(3600),
  syncIntervalSec: z.number().int().min(3600).max(86_400),
  timezone: z.string().min(1).max(64),
});
export type HouseSettings = z.infer<typeof HouseSettingsSchema>;

export const HouseSchema = z.object({
  id: uuid,
  name: z.string(),
  createdAt: epochMs,
  modifiedAt: epochMs,
  settings: HouseSettingsSchema,
});
export type House = z.infer<typeof HouseSchema>;

export const HouseNameSchema = z.string().trim().min(2).max(32);
export const HousePatchSchema = HouseSettingsSchema.partial().extend({ name: HouseNameSchema.optional() }).strict();
export type HousePatch = z.infer<typeof HousePatchSchema>;

export const CatSchema = z.object({
  id: uuid,
  houseId: uuid,
  name: z.string(),
  color: CatColorSchema,
  avatarPose: AvatarPoseSchema,
  hungryAfterSec: z.number().int(),
  sortOrder: z.number().int(),
  /** Denormalised from the latest feeding (spec §1.5); null until the first one. */
  defaultAmountMg: z.number().int().nullable(),
  defaultEnteredUnit: FoodUnitSchema.nullable(),
  defaultEnteredValue: z.string().nullable(),
  lastFedAt: epochMs.nullable(),
  createdAt: epochMs,
  modifiedAt: epochMs,
});
export type Cat = z.infer<typeof CatSchema>;

export const CatNameSchema = z.string().trim().min(1).max(32);
export const CatCreateSchema = z.object({
  id: uuid,
  name: CatNameSchema,
  color: CatColorSchema.default(CAT_COLORS[0]),
  avatarPose: AvatarPoseSchema.default("C2"),
  hungryAfterSec: z.number().int().min(3600).max(86_400).optional(),
});
export type CatCreate = z.infer<typeof CatCreateSchema>;
export const CatPatchSchema = z
  .object({
    name: CatNameSchema,
    color: CatColorSchema,
    avatarPose: AvatarPoseSchema,
    hungryAfterSec: z.number().int().min(3600).max(86_400),
    sortOrder: z.number().int().min(0).max(100),
  })
  .partial()
  .strict();
export type CatPatch = z.infer<typeof CatPatchSchema>;

export const FeedingSourceSchema = z.enum(["device", "web"]);
export const EnteredValueSchema = z.string().trim().min(1).max(16);
export const FeedingSchema = z.object({
  id: uuid,
  houseId: uuid,
  catId: uuid,
  fedAt: epochMs,
  amountMg: z.number().int().positive(),
  enteredUnit: FoodUnitSchema,
  enteredValue: EnteredValueSchema,
  source: FeedingSourceSchema,
  deviceId: z.string().nullable(),
  clientId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: epochMs,
  modifiedAt: epochMs,
});
export type Feeding = z.infer<typeof FeedingSchema>;

export const FeedingCreateSchema = z.object({
  id: uuid,
  catId: uuid,
  fedAt: epochMs,
  amountMg: z.number().int().positive(),
  enteredUnit: FoodUnitSchema,
  enteredValue: EnteredValueSchema,
  note: z.string().max(200).optional(),
});
export type FeedingCreate = z.infer<typeof FeedingCreateSchema>;
export const FeedingPatchSchema = z
  .object({
    catId: uuid,
    fedAt: epochMs,
    amountMg: z.number().int().positive(),
    enteredUnit: FoodUnitSchema,
    enteredValue: EnteredValueSchema,
    note: z.string().max(200).nullable(),
  })
  .partial()
  .strict();
export type FeedingPatch = z.infer<typeof FeedingPatchSchema>;

/** GET /api/feedings — newest first, cursor = fedAt of the last row. */
export const FeedingsPageSchema = z.object({
  items: z.array(FeedingSchema),
  nextCursor: epochMs.nullable(),
});
export type FeedingsPage = z.infer<typeof FeedingsPageSchema>;

export const PinSchema = z.string().regex(/^\d{4,12}$/, "4 to 12 digits");
export const SetupBodySchema = z.object({ houseName: HouseNameSchema, pin: PinSchema });
export const LoginBodySchema = SetupBodySchema;
export const RefreshBodySchema = z.object({ refreshToken: z.string().min(16) });
export const PinChangeBodySchema = z.object({ currentPin: PinSchema, newPin: PinSchema });
export const TokensResponseSchema = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires; the client refreshes a minute early. */
  expiresIn: z.number().int(),
  refreshToken: z.string(),
  house: HouseSchema,
});
export type TokensResponse = z.infer<typeof TokensResponseSchema>;

const dataUnder1Kb = (d: unknown) => d === undefined || JSON.stringify(d).length <= 1024;
export const LogsUploadBodySchema = z
  .array(LogEntrySchema.refine((e) => dataUnder1Kb(e.data), "data over 1 KB"))
  .max(50);
export const DebugLogsQuerySchema = z.object({
  source: z.enum(["web", "worker", "device"]).optional(),
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type DebugLogsQuery = z.infer<typeof DebugLogsQuerySchema>;
