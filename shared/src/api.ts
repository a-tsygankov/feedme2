import { z } from "zod";
import { LogEntrySchema } from "./log.ts";
import { parseEnteredValue } from "./units.ts";

/** Spec §1.4 — the house's units and device settings. */
export const FoodUnitSchema = z.enum(["g", "oz", "can"]);
export const CanFractionStepSchema = z.enum(["1/4", "1/3", "1/2"]);
export type FoodUnit = z.infer<typeof FoodUnitSchema>;
export type CanFractionStep = z.infer<typeof CanFractionStepSchema>;
/** Spec §1.7 — the five calm poses offered as identities. */
export const AvatarPoseSchema = z.enum(["A1", "A4", "B1", "C1", "C2"]);
export type AvatarPose = z.infer<typeof AvatarPoseSchema>;

export const MAX_CATS = 8;

/** Eight swatches that survive tinting on both themes and on the dark
 * device screen. The first is the default. */
export const CAT_COLORS = [
  "#4CAF50", "#2196F3", "#E91E63", "#8B4513", "#FF9800", "#9C27B0", "#00BCD4", "#607D8B",
] as const;
export const CatColorSchema = z.enum(CAT_COLORS);
export type CatColor = z.infer<typeof CatColorSchema>;

/** Lowercase canonical form only: D1 text primary keys are case-sensitive,
 * `crypto.randomUUID()` is lowercase, and firmware must match. */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "lowercase uuid");
/** Capped at 2100-01-01 so a far-future fedAt is a 400, and D1 integers stay safe. */
const epochMs = z.number().int().nonnegative().max(4_102_444_800_000);
/** feedings.fed_at is CHECK (fed_at > 0): reject 0 here so the DB never answers with a 500. */
const fedAtMs = epochMs.min(1);
/** A 5 kg feeding is a typo. */
const amountMg = z.number().int().positive().max(5_000_000);

const hasAnyKey = (o: object) => Object.values(o).some((v) => v !== undefined);
const EMPTY_PATCH = "empty patch";

export const HouseSettingsSchema = z.object({
  foodUnit: FoodUnitSchema,
  canSizeMg: z.number().int().min(10_000).max(1_000_000),
  canFractionStep: CanFractionStepSchema,
  gramStep: z.union([z.literal(1), z.literal(5), z.literal(10)]),
  ozStepHundredths: z.union([z.literal(25), z.literal(50)]),
  hungryAfterSecDefault: z.number().int().min(3600).max(86_400),
  sleepTimeoutSec: z.number().int().min(60).max(3600),
  syncIntervalSec: z.number().int().min(3600).max(86_400),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "unknown IANA timezone"),
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
export const HousePatchSchema = HouseSettingsSchema.partial()
  .extend({ name: HouseNameSchema.optional() })
  .strict()
  .refine(hasAnyKey, EMPTY_PATCH);
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
  defaultAmountMg: amountMg.nullable(),
  defaultEnteredUnit: FoodUnitSchema.nullable(),
  defaultEnteredValue: z.string().nullable(),
  lastFedAt: epochMs.nullable(),
  createdAt: epochMs,
  modifiedAt: epochMs,
});
export type Cat = z.infer<typeof CatSchema>;

// Create bodies strip unknown keys, patches reject them (.strict()), deliberately.
export const CatNameSchema = z.string().trim().min(1).max(32);
export const CatCreateSchema = z.object({
  id: uuid,
  name: CatNameSchema,
  color: CatColorSchema.default(CAT_COLORS[0]),
  avatarPose: AvatarPoseSchema.default("C2"),
  hungryAfterSec: z.number().int().min(3600).max(86_400).optional(),
});
export type CatCreate = z.infer<typeof CatCreateSchema>;
export type CatCreateInput = z.input<typeof CatCreateSchema>;
export const CatPatchSchema = z
  .object({
    name: CatNameSchema,
    color: CatColorSchema,
    avatarPose: AvatarPoseSchema,
    hungryAfterSec: z.number().int().min(3600).max(86_400),
    sortOrder: z.number().int().min(0).max(100),
  })
  .partial()
  .strict()
  .refine(hasAnyKey, EMPTY_PATCH);
export type CatPatch = z.infer<typeof CatPatchSchema>;

export const FeedingSourceSchema = z.enum(["device", "web"]);
export type FeedingSource = z.infer<typeof FeedingSourceSchema>;
export const EnteredValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .refine((s) => parseEnteredValue(s) !== null, "not a positive amount");
export const FeedingSchema = z.object({
  id: uuid,
  houseId: uuid,
  catId: uuid,
  fedAt: fedAtMs,
  amountMg,
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

// Create bodies strip unknown keys, patches reject them (.strict()), deliberately.
export const FeedingCreateSchema = z.object({
  id: uuid,
  catId: uuid,
  fedAt: fedAtMs,
  amountMg,
  enteredUnit: FoodUnitSchema,
  enteredValue: EnteredValueSchema,
  note: z.string().max(200).nullish(),
});
export type FeedingCreate = z.infer<typeof FeedingCreateSchema>;
export const FeedingPatchSchema = z
  .object({
    catId: uuid,
    fedAt: fedAtMs,
    amountMg,
    enteredUnit: FoodUnitSchema,
    enteredValue: EnteredValueSchema,
    note: z.string().max(200).nullable(),
  })
  .partial()
  .strict()
  .refine(hasAnyKey, EMPTY_PATCH)
  // The three describe one amount: a lone amountMg would leave the displayed
  // unit/value disagreeing with the stored milligrams.
  .refine(
    (p) => {
      const present = [p.amountMg, p.enteredUnit, p.enteredValue].map((v) => v !== undefined);
      return present.every(Boolean) || !present.some(Boolean);
    },
    { message: "amount fields travel together", path: ["amountMg"] },
  );
export type FeedingPatch = z.infer<typeof FeedingPatchSchema>;

/** Opaque-ish pagination cursor: "<fedAt>:<id>". */
export const FeedingsCursorSchema = z.string().regex(/^\d{1,13}:[0-9a-f-]{36}$/);
export type FeedingsCursor = z.infer<typeof FeedingsCursorSchema>;
export function encodeFeedingsCursor(fedAt: number, id: string): string {
  return `${fedAt}:${id}`;
}
export function decodeFeedingsCursor(s: string): { fedAt: number; id: string } {
  const c = FeedingsCursorSchema.parse(s);
  const i = c.indexOf(":");
  return { fedAt: Number(c.slice(0, i)), id: c.slice(i + 1) };
}

/** GET /api/feedings — newest first; cursor = fedAt:id of the last row; the
 * pair is unique, fedAt alone is not (several cats fed at once). */
export const FeedingsPageSchema = z.object({
  items: z.array(FeedingSchema),
  nextCursor: FeedingsCursorSchema.nullable(),
});
export type FeedingsPage = z.infer<typeof FeedingsPageSchema>;

export const PinSchema = z.string().regex(/^\d{4,12}$/, "4 to 12 digits");
export const SetupBodySchema = z.object({ houseName: HouseNameSchema, pin: PinSchema });
export type SetupBody = z.infer<typeof SetupBodySchema>;
// Login must keep working for houses created under older setup rules; the
// name/pin format is enforced at setup and pin-change only.
export const LoginBodySchema = z.object({ houseName: z.string().trim().min(1).max(64), pin: z.string().min(1).max(64) });
export type LoginBody = z.infer<typeof LoginBodySchema>;
export const RefreshBodySchema = z.object({ refreshToken: z.string().min(16).max(256) });
export type RefreshBody = z.infer<typeof RefreshBodySchema>;
export const PinChangeBodySchema = z.object({ currentPin: PinSchema, newPin: PinSchema });
export type PinChangeBody = z.infer<typeof PinChangeBodySchema>;
export const TokensResponseSchema = z.object({
  accessToken: z.string().min(1),
  /** Seconds until the access token expires; the client refreshes a minute early. */
  expiresIn: z.number().int().positive(),
  refreshToken: z.string().min(1),
  house: HouseSchema,
});
export type TokensResponse = z.infer<typeof TokensResponseSchema>;

/** UTF-8 bytes, not UTF-16 units: the cap protects row size in D1. */
const dataUnder1Kb = (d: unknown) => d === undefined || new TextEncoder().encode(JSON.stringify(d)).length <= 1024;
/** The server stamps source=web; a web client must not forge device/worker rows. */
export const LogUploadEntrySchema = LogEntrySchema.omit({ source: true, deviceId: true });
export type LogUploadEntry = z.infer<typeof LogUploadEntrySchema>;
export const LogsUploadBodySchema = z
  .array(LogUploadEntrySchema.refine((e) => dataUnder1Kb(e.data), { message: "data over 1 KB", path: ["data"] }))
  .max(50);
export type LogsUploadBody = z.infer<typeof LogsUploadBodySchema>;
export const DebugLogsQuerySchema = z.object({
  source: z.enum(["web", "worker", "device"]).optional(),
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  device: z.string().max(64).optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type DebugLogsQuery = z.infer<typeof DebugLogsQuerySchema>;
export type DebugLogsQueryInput = z.input<typeof DebugLogsQuerySchema>;
