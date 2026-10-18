/**
 * Drizzle schema. Mirrors backend/migrations/*.sql, which remain the
 * source of truth and are applied by wrangler — never run
 * `drizzle-kit push`. Column names stay snake_case in the database and
 * camelCase in TypeScript.
 */
import { foreignKey, index, integer, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";

/*
 * Not expressible here, enforced by the SQL only: every CHECK constraint
 * (positive amounts/intervals, enum columns, the cats default triple being
 * all-set-or-all-NULL). Index declarations below omit DESC/ordering
 * direction because drizzle-kit is never run (migrations are hand-written)
 * and SQLite scans an index backwards at no cost; the migration keeps the
 * DESC for fidelity with the cursor-paging queries.
 */

export const houses = sqliteTable("houses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull().unique(),
  pinSalt: text("pin_salt").notNull(),
  pinHash: text("pin_hash").notNull(),
  foodUnit: text("food_unit", { enum: ["g", "oz", "can"] }).notNull().default("g"),
  canSizeMg: integer("can_size_mg").notNull().default(155922),
  canFractionStep: text("can_fraction_step", { enum: ["1/4", "1/3", "1/2"] }).notNull().default("1/4"),
  gramStep: integer("gram_step").notNull().default(5),
  ozStepHundredths: integer("oz_step_hundredths").notNull().default(25),
  hungryAfterSecDefault: integer("hungry_after_sec_default").notNull().default(18000),
  sleepTimeoutSec: integer("sleep_timeout_sec").notNull().default(300),
  syncIntervalSec: integer("sync_interval_sec").notNull().default(21600),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: integer("created_at").notNull(),
  modifiedAt: integer("modified_at").notNull(),
  deletedAt: integer("deleted_at"),
});

export const cats = sqliteTable(
  "cats",
  {
    id: text("id").primaryKey(),
    houseId: text("house_id").notNull().references(() => houses.id),
    name: text("name").notNull(),
    color: text("color").notNull(),
    avatarPose: text("avatar_pose").notNull().default("C2"),
    hungryAfterSec: integer("hungry_after_sec").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    defaultAmountMg: integer("default_amount_mg"),
    defaultEnteredUnit: text("default_entered_unit", { enum: ["g", "oz", "can"] }),
    defaultEnteredValue: text("default_entered_value"),
    lastFedAt: integer("last_fed_at"),
    createdAt: integer("created_at").notNull(),
    modifiedAt: integer("modified_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => ({
    houseIdx: index("cats_house").on(t.houseId, t.sortOrder),
    // Target of feedings' composite tenancy FK.
    houseCat: unique().on(t.houseId, t.id),
  }),
);

export const feedings = sqliteTable(
  "feedings",
  {
    id: text("id").primaryKey(),
    houseId: text("house_id").notNull().references(() => houses.id),
    catId: text("cat_id").notNull(),
    fedAt: integer("fed_at").notNull(),
    amountMg: integer("amount_mg").notNull(),
    enteredUnit: text("entered_unit", { enum: ["g", "oz", "can"] }).notNull(),
    enteredValue: text("entered_value").notNull(),
    source: text("source", { enum: ["device", "web"] }).notNull(),
    deviceId: text("device_id"),
    clientId: text("client_id"),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
    modifiedAt: integer("modified_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => ({
    houseTime: index("feedings_house_time").on(t.houseId, t.fedAt, t.id),
    catTime: index("feedings_cat_time").on(t.houseId, t.catId, t.fedAt, t.id),
    // A feeding can only reference a cat of its own house.
    catInHouse: foreignKey({ columns: [t.houseId, t.catId], foreignColumns: [cats.houseId, cats.id] }),
  }),
);

export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    houseId: text("house_id").notNull().references(() => houses.id),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    rotatedFrom: text("rotated_from"),
  },
  (t) => ({
    houseIdx: index("refresh_tokens_house").on(t.houseId),
    rotatedFromIdx: index("refresh_tokens_rotated_from").on(t.rotatedFrom),
  }),
);

export const logEntries = sqliteTable(
  "log_entries",
  {
    id: text("id").primaryKey(),
    houseId: text("house_id"),
    source: text("source", { enum: ["web", "worker", "device"] }).notNull(),
    deviceId: text("device_id"),
    clientId: text("client_id"),
    ts: integer("ts").notNull(),
    level: text("level", { enum: ["debug", "info", "warn", "error"] }).notNull(),
    msg: text("msg").notNull(),
    data: text("data"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    houseTs: index("log_entries_house_ts").on(t.houseId, t.ts),
    // Retention prunes by server-set created_at, not client ts.
    createdAtIdx: index("log_entries_created_at").on(t.createdAt),
  }),
);

export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    houseId: text("house_id").notNull().references(() => houses.id),
    name: text("name").notNull(),
    hwModel: text("hw_model").notNull(),
    fwVersion: text("fw_version").notNull(),
    /** jti of the only token valid for this row; re-rolled at every pairing (see 0002). */
    tokenId: text("token_id").notNull(),
    lastSeenAt: integer("last_seen_at"),
    batteryPct: integer("battery_pct"),
    resetReason: text("reset_reason"),
    autoInstall: integer("auto_install").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    modifiedAt: integer("modified_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (t) => ({ houseIdx: index("devices_house").on(t.houseId) }),
);

export const pendingPairings = sqliteTable(
  "pending_pairings",
  {
    deviceId: text("device_id").primaryKey(),
    pairCode: text("pair_code").notNull(),
    hwModel: text("hw_model").notNull(),
    fwVersion: text("fw_version").notNull(),
    requestedAt: integer("requested_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    pollSecretHash: text("poll_secret_hash").notNull(),
    houseId: text("house_id").references(() => houses.id),
    confirmedAt: integer("confirmed_at"),
    deviceToken: text("device_token"),
    deliveredAt: integer("delivered_at"),
  },
  (t) => ({ codeIdx: uniqueIndex("pending_pairings_code").on(t.pairCode), expiresIdx: index("pending_pairings_expires").on(t.expiresAt) }),
);

export const pairAttempts = sqliteTable("pair_attempts", {
  houseId: text("house_id").primaryKey(),
  windowStart: integer("window_start").notNull(),
  failures: integer("failures").notNull(),
});

/** One-time QR login tokens (0003). Only the SHA-256 hex of the token is stored, never the token. */
export const loginQrTokens = sqliteTable(
  "login_qr_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    deviceId: text("device_id").notNull(),
    houseId: text("house_id").notNull(),
    deviceTokenId: text("device_token_id").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
  },
  (t) => ({ deviceIdx: index("login_qr_tokens_device").on(t.deviceId), expiresIdx: index("login_qr_tokens_expires").on(t.expiresAt) }),
);

/** Immutable, idempotent device scale observations (migration 0004).
 * Historical house ownership is captured at ingest, even after re-pairing.
 */
export const scaleEvents = sqliteTable(
  "scale_events",
  {
    id: text("id").primaryKey(),
    houseId: text("house_id").notNull().references(() => houses.id),
    deviceId: text("device_id").notNull().references(() => devices.id),
    pairingTokenId: text("pairing_token_id").notNull(),
    sequence: integer("sequence").notNull(),
    kind: text("kind", { enum: ["stable_weight", "bowl_removed", "bowl_returned", "sensor_fault"] }).notNull(),
    observedAt: integer("observed_at").notNull(),
    receivedAt: integer("received_at").notNull(),
    calibrationRevision: integer("calibration_revision").notNull(),
    grossMg: integer("gross_mg"),
    faultCode: text("fault_code", { enum: ["adc_timeout", "sensor_disconnected", "overload", "calibration_invalid"] }),
  },
  (t) => ({
    houseDeviceTime: index("scale_events_house_device_time").on(t.houseId, t.deviceId, t.observedAt, t.id),
    devicePairSequence: unique().on(t.deviceId, t.pairingTokenId, t.sequence),
  }),
);
