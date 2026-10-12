import { env } from "cloudflare:test";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { beforeAll, describe, expect, it } from "vitest";
import { cats, devices, feedings, houses, logEntries, pairAttempts, pendingPairings, refreshTokens } from "../src/db/schema.ts";
import { applyAllMigrations, MIGRATIONS } from "./helpers/migrate.ts";

const now = 1_700_000_000_000;
let seq = 0;
const uid = (p: string) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

async function insertRow(table: string, row: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(row);
  await env.DB.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .bind(...keys.map((k) => row[k])).run();
}

async function insertHouse(over: Record<string, unknown> = {}): Promise<string> {
  const id = uid("house");
  await insertRow("houses", { id, name: id, name_key: id, pin_salt: "x", pin_hash: "y", created_at: now, modified_at: now, ...over });
  return id;
}

async function insertCat(houseId: string, over: Record<string, unknown> = {}): Promise<string> {
  const id = uid("cat");
  await insertRow("cats", {
    id, house_id: houseId, name: "Mochi", color: "#fff", hungry_after_sec: 18000,
    created_at: now, modified_at: now, ...over,
  });
  return id;
}

async function insertFeeding(houseId: string, catId: string, over: Record<string, unknown> = {}): Promise<string> {
  const id = uid("feeding");
  await insertRow("feedings", {
    id, house_id: houseId, cat_id: catId, fed_at: now, amount_mg: 50_000, entered_unit: "g",
    entered_value: "50", source: "web", created_at: now, modified_at: now, ...over,
  });
  return id;
}

describe("migration 0001", () => {
  beforeAll(applyAllMigrations);

  it("creates the house data model with the spec's columns", async () => {
    const cols = async (table: string) =>
      (await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results.map((r) => r.name);
    expect(await cols("houses")).toEqual(
      expect.arrayContaining(["id", "name", "name_key", "pin_salt", "pin_hash", "food_unit", "can_size_mg",
        "can_fraction_step", "gram_step", "oz_step_hundredths", "hungry_after_sec_default",
        "sleep_timeout_sec", "sync_interval_sec", "timezone", "created_at", "modified_at", "deleted_at"]),
    );
    expect(await cols("cats")).toEqual(
      expect.arrayContaining(["id", "house_id", "name", "color", "avatar_pose", "hungry_after_sec", "sort_order",
        "default_amount_mg", "default_entered_unit", "default_entered_value", "last_fed_at",
        "created_at", "modified_at", "deleted_at"]),
    );
    expect(await cols("feedings")).toEqual(
      expect.arrayContaining(["id", "house_id", "cat_id", "fed_at", "amount_mg", "entered_unit", "entered_value",
        "source", "device_id", "client_id", "note", "created_at", "modified_at", "deleted_at"]),
    );
    expect(await cols("refresh_tokens")).toEqual(
      expect.arrayContaining(["id", "house_id", "token_hash", "created_at", "expires_at", "rotated_from"]),
    );
  });

  it("rejects a second house with the same name in a different case", async () => {
    const insert = (id: string, name: string) =>
      env.DB.prepare(
        "INSERT INTO houses (id, name, name_key, pin_salt, pin_hash, created_at, modified_at) VALUES (?, ?, lower(?), 'x', 'y', ?, ?)",
      ).bind(id, name, name, now, now).run();
    await insert("h1", "Mochi House");
    await expect(insert("h2", "mochi house")).rejects.toThrow(/UNIQUE/);
  });

  it("records the schema version as the newest migration", async () => {
    const row = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1").first<{ name: string }>();
    expect(row?.name).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.name);
  });

  it("0002 adds devices and pending_pairings with their constraints", async () => {
    const cols = async (t: string) => (await env.DB.prepare(`PRAGMA table_info(${t})`).all<{ name: string }>()).results.map((r) => r.name);
    expect(await cols("devices")).toEqual(expect.arrayContaining(["id", "house_id", "name", "hw_model", "fw_version", "last_seen_at", "battery_pct", "reset_reason", "auto_install", "created_at", "modified_at", "revoked_at", "token_id"]));
    expect(await cols("pending_pairings")).toEqual(expect.arrayContaining(["device_id", "pair_code", "requested_at", "expires_at", "house_id", "confirmed_at", "device_token", "delivered_at", "poll_secret_hash"]));
    expect(await cols("pending_pairings")).not.toContain("cancelled_at");
    expect(await cols("pair_attempts")).toEqual(["house_id", "window_start", "failures"]);
    // id must be 32 lowercase hex
    await expect(env.DB.prepare("INSERT INTO devices (id, house_id, name, hw_model, fw_version, auto_install, created_at, modified_at, token_id) VALUES ('XYZ', 'h', 'n', 'crowpanel', '0.1.0', 0, 1, 1, 't')").run()).rejects.toThrow(/CHECK/);
    // battery_pct within 0..100 or NULL
    await expect(env.DB.prepare("INSERT INTO devices (id, house_id, name, hw_model, fw_version, battery_pct, auto_install, created_at, modified_at, token_id) VALUES (?, 'h', 'n', 'crowpanel', '0.1.0', 101, 0, 1, 1, 't')").bind("a".repeat(32)).run()).rejects.toThrow(/CHECK/);
    // every device row carries the id of the pairing its token belongs to
    await expect(env.DB.prepare("INSERT INTO devices (id, house_id, name, hw_model, fw_version, auto_install, created_at, modified_at) VALUES (?, 'h', 'n', 'crowpanel', '0.1.0', 0, 1, 1)").bind("b".repeat(32)).run()).rejects.toThrow(/NOT NULL/);
    // pending_pairings: hex device id, 6-digit code, and a poll secret hash
    const pend = (id: string, code: string) => env.DB.prepare("INSERT INTO pending_pairings (device_id, pair_code, hw_model, fw_version, requested_at, expires_at, poll_secret_hash) VALUES (?, ?, 'simulator', '0.1.0', 1, 2, 'h')").bind(id, code).run();
    await expect(pend("Z".repeat(32), "123456")).rejects.toThrow(/CHECK/);
    await expect(pend("c".repeat(32), "12a456")).rejects.toThrow(/CHECK/);
    await expect(pend("c".repeat(32), "12345")).rejects.toThrow(/CHECK/);
    await expect(env.DB.prepare("INSERT INTO pending_pairings (device_id, pair_code, hw_model, fw_version, requested_at, expires_at) VALUES (?, '123456', 'simulator', '0.1.0', 1, 2)").bind("c".repeat(32)).run()).rejects.toThrow(/NOT NULL/);
    // one pairing row per device (PK) and a unique code among rows
    const idx = (await env.DB.prepare("PRAGMA index_list(pending_pairings)").all<{ name: string; unique: number }>()).results;
    expect(idx.some((i) => i.name === "pending_pairings_code" && i.unique === 1)).toBe(true);
  });

  describe("constraints", () => {
    it("rejects a food_unit outside g/oz/can", async () => {
      await expect(insertHouse({ food_unit: "cups" })).rejects.toThrow(/CHECK/);
    });

    it.each(["can_size_mg", "hungry_after_sec_default", "sleep_timeout_sec", "sync_interval_sec"])(
      "rejects houses.%s = 0",
      async (col) => {
        await expect(insertHouse({ [col]: 0 })).rejects.toThrow(/CHECK/);
      },
    );

    it("rejects cats.hungry_after_sec = 0", async () => {
      const h = await insertHouse();
      await expect(insertCat(h, { hungry_after_sec: 0 })).rejects.toThrow(/CHECK/);
    });

    it("rejects a cat whose house does not exist (FK)", async () => {
      await expect(insertCat("no-such-house")).rejects.toThrow(/FOREIGN KEY/);
    });

    it("rejects cats.default_amount_mg = 0 but allows NULL", async () => {
      const h = await insertHouse();
      await expect(
        insertCat(h, { default_amount_mg: 0, default_entered_unit: "g", default_entered_value: "0" }),
      ).rejects.toThrow(/CHECK/);
      await insertCat(h);
    });

    it("requires the cat default triple to be all set or all NULL", async () => {
      const h = await insertHouse();
      await expect(insertCat(h, { default_amount_mg: 50_000 })).rejects.toThrow(/CHECK/);
      await expect(
        insertCat(h, { default_amount_mg: 50_000, default_entered_unit: "g" }),
      ).rejects.toThrow(/CHECK/);
      await expect(insertCat(h, { default_entered_unit: "g", default_entered_value: "50" })).rejects.toThrow(/CHECK/);
      await insertCat(h, { default_amount_mg: 50_000, default_entered_unit: "g", default_entered_value: "50" });
    });

    it("rejects amount_mg = 0 and fed_at = 0 on feedings", async () => {
      const h = await insertHouse();
      const c = await insertCat(h);
      await expect(insertFeeding(h, c, { amount_mg: 0 })).rejects.toThrow(/CHECK/);
      await expect(insertFeeding(h, c, { fed_at: 0 })).rejects.toThrow(/CHECK/);
      await insertFeeding(h, c);
    });

    it("rejects a feeding whose house differs from its cat's house (composite FK)", async () => {
      const a = await insertHouse();
      const b = await insertHouse();
      const catA = await insertCat(a);
      await expect(insertFeeding(b, catA)).rejects.toThrow(/FOREIGN KEY/);
      await insertFeeding(a, catA);
    });

    it("rejects a duplicate refresh token hash", async () => {
      const h = await insertHouse();
      const insert = () =>
        insertRow("refresh_tokens", {
          id: uid("rt"), house_id: h, token_hash: "same-hash", created_at: now, expires_at: now + 1000,
        });
      await insert();
      await expect(insert()).rejects.toThrow(/UNIQUE/);
    });
  });

  describe("indexes", () => {
    const indexColumns = async (name: string) =>
      (await env.DB.prepare(`PRAGMA index_info(${name})`).all<{ seqno: number; name: string }>()).results
        .sort((x, y) => x.seqno - y.seqno)
        .map((r) => r.name);
    const indexNames = async (table: string) =>
      (await env.DB.prepare(`PRAGMA index_list(${table})`).all<{ name: string }>()).results.map((r) => r.name);

    it("pages feedings by (house_id, fed_at, id) and (house_id, cat_id, fed_at, id)", async () => {
      expect(await indexColumns("feedings_house_time")).toEqual(["house_id", "fed_at", "id"]);
      expect(await indexColumns("feedings_cat_time")).toEqual(["house_id", "cat_id", "fed_at", "id"]);
    });

    it("keeps feedings_house_time descending (the DESC survives in the DDL)", async () => {
      const row = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE name = 'feedings_house_time'").first<{ sql: string }>();
      expect(row?.sql).toMatch(/fed_at DESC,\s*id DESC/);
    });

    it("indexes log_entries.created_at for retention pruning and refresh_tokens.rotated_from", async () => {
      expect(await indexNames("log_entries")).toContain("log_entries_created_at");
      expect(await indexColumns("log_entries_created_at")).toEqual(["created_at"]);
      expect(await indexNames("refresh_tokens")).toContain("refresh_tokens_rotated_from");
    });
  });

  describe("drizzle drift guard", () => {
    // The migrations are the source of truth and drizzle-kit is never run,
    // so nothing else notices when schema.ts and the SQL part ways.
    it.each([
      ["houses", houses],
      ["cats", cats],
      ["feedings", feedings],
      ["refresh_tokens", refreshTokens],
      ["log_entries", logEntries],
      ["devices", devices],
      ["pending_pairings", pendingPairings],
      ["pair_attempts", pairAttempts],
    ] as const)("%s matches PRAGMA table_info", async (table, drizzleTable) => {
      const info = (
        await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string; notnull: number; pk: number }>()
      ).results;
      const config = getTableConfig(drizzleTable);
      expect(config.name).toBe(table);
      expect(config.columns.map((c) => c.name).sort()).toEqual(info.map((c) => c.name).sort());
      for (const col of config.columns) {
        const sql = info.find((c) => c.name === col.name)!;
        // SQLite reports TEXT PRIMARY KEY as nullable; Drizzle treats it as NOT NULL.
        expect({ column: col.name, notNull: sql.notnull === 1 || sql.pk > 0 }).toEqual({
          column: col.name,
          notNull: col.notNull,
        });
      }
    });
  });
});
