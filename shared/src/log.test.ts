import { describe, expect, it } from "vitest";
import { LogEntrySchema } from "./log.ts";

describe("LogEntrySchema", () => {
  it("accepts a minimal entry", () => {
    const r = LogEntrySchema.safeParse({ ts: 1, level: "info", source: "web", msg: "hi" });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown level or source", () => {
    expect(LogEntrySchema.safeParse({ ts: 1, level: "trace", source: "web", msg: "x" }).success).toBe(false);
    expect(LogEntrySchema.safeParse({ ts: 1, level: "info", source: "phone", msg: "x" }).success).toBe(false);
  });
  it("caps msg at 500 chars", () => {
    expect(LogEntrySchema.safeParse({ ts: 1, level: "info", source: "web", msg: "x".repeat(501) }).success).toBe(false);
  });
});
