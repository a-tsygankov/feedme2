import { env } from "cloudflare:test";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { BufferSink, RingBuffer } from "@feedme2/shared";
import type { LogEntry } from "@feedme2/shared";
import { ConsoleSink, Logger, type LogSink } from "../src/logger.ts";
import { applyAllMigrations } from "./helpers/migrate.ts";

describe("Logger", () => {
  it("stamps source=worker and the clock, and fans out to every sink", () => {
    const seen: LogEntry[] = [];
    const sink: LogSink = { write: (e) => void seen.push(e) };
    const buffer = new RingBuffer<LogEntry>(10);
    const log = new Logger("worker", [sink, new BufferSink(buffer)], () => 1234);

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
    const log = new Logger("worker", [new ConsoleSink()], () => 5);
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
    const log = new Logger("worker", [{ write: (e) => void seen.push(e) }], () => 1);
    log.info("bare");
    expect(Object.hasOwn(seen[0]!, "data")).toBe(false);
  });
});

describe("request logging middleware", () => {
  beforeAll(applyAllMigrations);

  // singleWorker shares one module graph: an earlier file's SELF.fetch has already built the
  // router matcher of the shared app, and Hono refuses app.get() after that. Re-import fresh.
  async function freshApp() {
    vi.resetModules();
    return (await import("../src/index.ts")).app;
  }
  const persisted = (path: string) =>
    env.DB.prepare("SELECT level, msg, data FROM log_entries WHERE house_id IS NULL AND source = 'worker' AND data LIKE ? ORDER BY created_at, rowid")
      .bind(`%${path}%`)
      .all<{ level: string; msg: string; data: string }>();

  it("turns a throwing handler into a JSON 500 and persists an unhandled + request-failed line", async () => {
    const app = await freshApp();
    app.get("/api/__boom", () => {
      throw new Error("kaboom");
    });

    // app.request has no ExecutionContext: the middleware must await the flush itself.
    const res = await app.request("http://feedme2/api/__boom", undefined, env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });

    const rows = (await persisted("/api/__boom")).results;
    expect(rows.map((r) => [r.level, r.msg])).toEqual([
      ["error", "unhandled"],
      ["error", "request failed"],
    ]);
    expect(JSON.parse(rows[1]!.data)).toMatchObject({ path: "/api/__boom", error: "kaboom" });
  });

  it("answers malformed JSON with the validator's 400 and logs it at warn, not error", async () => {
    const app = await freshApp();
    app.post("/api/__json", zValidator("json", z.object({ a: z.string() })), (c) => c.json({ ok: true }));

    const res = await app.request(
      "http://feedme2/api/__json",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" },
      env,
    );
    expect(res.status).toBe(400);

    const rows = (await persisted("/api/__json")).results;
    expect(rows.map((r) => [r.level, r.msg])).toEqual([["warn", "request failed"]]);
  });
});
