/**
 * Drizzle schema. Mirrors backend/migrations/*.sql, which remain the
 * source of truth and are applied by wrangler — never run
 * `drizzle-kit push`. Column names stay snake_case in the database and
 * camelCase in TypeScript.
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  (t) => ({ houseIdx: index("cats_house").on(t.houseId, t.sortOrder) }),
);

export const feedings = sqliteTable(
  "feedings",
  {
    id: text("id").primaryKey(),
    houseId: text("house_id").notNull().references(() => houses.id),
    catId: text("cat_id").notNull().references(() => cats.id),
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
    houseTime: index("feedings_house_time").on(t.houseId, t.fedAt),
    catTime: index("feedings_cat_time").on(t.houseId, t.catId, t.fedAt),
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
  (t) => ({ houseIdx: index("refresh_tokens_house").on(t.houseId) }),
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
  (t) => ({ houseTs: index("log_entries_house_ts").on(t.houseId, t.ts) }),
);
