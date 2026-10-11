import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";

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
    const now = Date.now();
    const insert = (id: string, name: string) =>
      env.DB.prepare(
        "INSERT INTO houses (id, name, name_key, pin_salt, pin_hash, created_at, modified_at) VALUES (?, ?, lower(?), 'x', 'y', ?, ?)",
      ).bind(id, name, name, now, now).run();
    await insert("h1", "Mochi House");
    await expect(insert("h2", "mochi house")).rejects.toThrow(/UNIQUE/);
  });

  it("records the schema version as the newest migration", async () => {
    const row = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1").first<{ name: string }>();
    expect(row?.name).toBe("0001_houses_cats_feedings.sql");
  });
});
