import { describe, expect, it } from "vitest";
import { VersionResponseSchema } from "./version.ts";

describe("VersionResponseSchema", () => {
  it("parses the worker's /api/version body", () => {
    const body = {
      worker: { version: "0.1.0", env: "production" },
      schema: { version: "0000_init.sql" },
      firmware: { latest: null },
    };
    expect(VersionResponseSchema.parse(body)).toEqual(body);
  });
  it("allows schema.version to be null (no migrations applied)", () => {
    expect(
      VersionResponseSchema.safeParse({
        worker: { version: "0.1.0", env: "development" },
        schema: { version: null },
        firmware: { latest: null },
      }).success,
    ).toBe(true);
  });
});
