import { describe, expect, it } from "vitest";
import { DebugLogsResponseSchema, LogEntrySchema } from "./log.ts";

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
  it("accepts msg of exactly 500 chars and rejects a non-integer ts", () => {
    expect(LogEntrySchema.safeParse({ ts: 1, level: "info", source: "web", msg: "x".repeat(500) }).success).toBe(true);
    expect(LogEntrySchema.safeParse({ ts: 1.5, level: "info", source: "web", msg: "x" }).success).toBe(false);
  });
  it("DebugLogsResponseSchema wraps a list of entries", () => {
    const ok = DebugLogsResponseSchema.safeParse({ entries: [{ ts: 1, level: "info", source: "worker", msg: "hi" }] });
    expect(ok.success).toBe(true);
    expect(DebugLogsResponseSchema.safeParse({ entries: [{ ts: 1 }] }).success).toBe(false);
  });
});
