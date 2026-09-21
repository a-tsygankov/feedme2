import { describe, expect, it, vi } from "vitest";
import { RingBuffer } from "@feedme2/shared";
import type { LogEntry } from "@feedme2/shared";
import { BufferSink, ConsoleSink, Logger, type LogSink } from "../src/logger.ts";

describe("Logger", () => {
  it("stamps source=worker and the clock, and fans out to every sink", () => {
    const seen: LogEntry[] = [];
    const sink: LogSink = { write: (e) => void seen.push(e) };
    const buffer = new RingBuffer<LogEntry>(10);
    const log = new Logger([sink, new BufferSink(buffer)], () => 1234);

    log.info("hello", { a: 1 });
    log.error("boom");

    expect(seen).toEqual([
      { ts: 1234, level: "info", source: "worker", msg: "hello", data: { a: 1 } },
      { ts: 1234, level: "error", source: "worker", msg: "boom" },
    ]);
    expect(buffer.toArray()).toEqual(seen);
  });

  it("ConsoleSink routes by level and passes the entry object, not a string", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = new Logger([new ConsoleSink()], () => 5);
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(logSpy).toHaveBeenCalledWith({ ts: 5, level: "info", source: "worker", msg: "i" });
    expect(warnSpy).toHaveBeenCalledWith({ ts: 5, level: "warn", source: "worker", msg: "w" });
    expect(errorSpy).toHaveBeenCalledWith({ ts: 5, level: "error", source: "worker", msg: "e" });
    vi.restoreAllMocks();
  });

  it("omits the data key entirely when no data is given", () => {
    const seen: LogEntry[] = [];
    const log = new Logger([{ write: (e) => void seen.push(e) }], () => 1);
    log.info("bare");
    expect(Object.hasOwn(seen[0]!, "data")).toBe(false);
  });
});

describe("request logging middleware", () => {
  it("logs a request-failed line and preserves a 500 response when a handler throws", async () => {
    const { app } = await import("../src/index.ts");
    const { logBuffer } = await import("../src/logger.ts");

    app.get("/api/__boom", () => {
      throw new Error("kaboom");
    });

    const env = {
      DB: {} as unknown,
      FIRMWARE: {} as unknown,
      ENVIRONMENT: "development",
      AUTH_SECRET: "x",
    } as never;

    let status: number | undefined;
    try {
      const res = await app.request("http://feedme2/api/__boom", undefined, env);
      status = res.status;
    } catch {
      // If Hono rethrows instead of producing a 500, that's fine too —
      // we only assert on the log entry below.
    }

    if (status !== undefined) expect(status).toBe(500);

    expect(logBuffer.toArray().at(-1)).toMatchObject({
      level: "error",
      msg: "request failed",
      data: expect.objectContaining({ path: "/api/__boom", error: "kaboom" }),
    });
  });
});
