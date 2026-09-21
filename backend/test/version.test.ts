import { SELF } from "cloudflare:test";
import { VersionResponseSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import pkg from "../package.json";

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
