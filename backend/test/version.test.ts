import { env, SELF } from "cloudflare:test";
import { VersionResponseSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import pkg from "../package.json";
import { getLatestFirmwareVersion, getSchemaVersion } from "../src/version.ts";

describe("GET /api/version", () => {
  beforeAll(applyAllMigrations);

  it("reports worker, schema and firmware tiers in the shared shape", async () => {
    const res = await SELF.fetch("http://feedme2/api/version");
    expect(res.status).toBe(200);
    const body = VersionResponseSchema.parse(await res.json());
    expect(body.worker).toEqual({ version: pkg.version, env: "development" });
    // The newest applied migration is the schema version.
    expect(body.schema.version).toBe("0000_init.sql");
    // No firmware_releases table yet (Phase 3).
    expect(body.firmware.latest).toBeNull();
  });
});

describe("version getters", () => {
  it("return null when the table is absent, and rethrow anything else", async () => {
    // firmware_releases does not exist in Phase 0.
    expect(await getLatestFirmwareVersion(env.DB)).toBeNull();
    // A database that throws something other than "no such table" must
    // not be reported as "no migrations applied".
    const broken = {
      prepare: () => ({
        first: () => Promise.reject(new Error("D1_ERROR: storage unavailable")),
      }),
    } as unknown as D1Database;
    await expect(getSchemaVersion(broken)).rejects.toThrow("storage unavailable");
  });
});
