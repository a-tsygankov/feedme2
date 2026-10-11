import { env } from "cloudflare:test";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BufferSink, DebugLogsResponseSchema, RingBuffer } from "@feedme2/shared";
import type { LogEntry } from "@feedme2/shared";
import { db } from "../src/db/client.ts";
import { ConsoleSink, D1Sink, Logger, type LogSink } from "../src/logger.ts";
import { LogsRepo } from "../src/repos/logs.ts";
import { currentRequest, flushRequestLogs, runWithRequestContext } from "../src/request-context.ts";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";

describe("Logger", () => {
  // afterEach, not inline: a failed expect would otherwise leave the console spies installed for later tests.
  afterEach(() => vi.restoreAllMocks());

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
  afterEach(() => vi.restoreAllMocks());

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

  type Row = { level: string; msg: string; data: string | null; client_id: string | null };
  const houseRows = async (houseId: string) =>
    (
      await env.DB.prepare("SELECT level, msg, data, client_id FROM log_entries WHERE house_id = ? ORDER BY created_at, rowid")
        .bind(houseId)
        .all<Row>()
    ).results;
  const authed = (access: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { authorization: `Bearer ${access}`, ...(init.headers ?? {}) } });

  it("derives the request line's level from the status when nothing was thrown", async () => {
    const s = await signup();
    const app = await freshApp();
    app.get("/api/__503", (c) => c.json({}, 503));
    app.get("/api/__404", (c) => c.json({}, 404));
    app.get("/api/__200", (c) => c.json({}, 200));
    for (const p of ["__503", "__404", "__200"]) await app.request(`http://feedme2/api/${p}`, authed(s.access), env);
    const lines = (await houseRows(s.houseId)).filter((r) => r.msg === "request").map((r) => [JSON.parse(r.data!).path, r.level]);
    expect(lines).toEqual([
      ["/api/__503", "error"],
      ["/api/__404", "warn"],
      ["/api/__200", "info"],
    ]);
  });

  it("bounds a worker row written for a throwing route with a 5 KB message, and the console feed still parses", async () => {
    const s = await signup();
    const app = await freshApp();
    app.get("/api/__huge", () => {
      throw new Error("x".repeat(5000));
    });
    expect((await app.request("http://feedme2/api/__huge", authed(s.access), env)).status).toBe(500);

    const rows = await houseRows(s.houseId);
    expect(rows.map((r) => [r.level, r.msg])).toEqual([
      ["error", "unhandled"],
      ["error", "request failed"],
    ]);
    for (const r of rows) {
      expect(r.msg.length).toBeLessThanOrEqual(500);
      expect(new TextEncoder().encode(r.data ?? "").length).toBeLessThanOrEqual(1024);
    }
    const unhandled = JSON.parse(rows[0]!.data!);
    expect(unhandled.truncated).toBeUndefined();
    expect(unhandled.error).toHaveLength(300);
    expect(unhandled.stack.length).toBeLessThanOrEqual(1000);
    const feed = DebugLogsResponseSchema.parse(await (await app.request("http://feedme2/api/debug/logs?limit=50", authed(s.access), env)).json());
    expect(feed.entries.filter((e) => e.source === "worker").length).toBeGreaterThanOrEqual(2);
  });

  it("stores an unserialisable or oversized data object as a marker, and caps msg at 500", async () => {
    const s = await signup();
    const repo = new LogsRepo(db(env.DB));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const now = Date.now();
    await repo.insertMany(
      s.houseId,
      [
        { ts: now, level: "info", source: "worker", msg: "m".repeat(900), data: circular },
        { ts: now, level: "info", source: "worker", msg: "big", data: { s: "é".repeat(600) } },
        { ts: now, level: "info", source: "worker", msg: "bigint", data: { n: 10n } },
      ],
      {},
      now,
    );
    const rows = await houseRows(s.houseId);
    expect(rows[0]!.msg).toHaveLength(500);
    expect(JSON.parse(rows[0]!.data!)).toEqual({ unserialisable: true });
    expect(JSON.parse(rows[1]!.data!)).toEqual({ truncated: true, bytes: expect.any(Number) });
    expect(JSON.parse(rows[1]!.data!).bytes).toBeGreaterThan(1024);
    expect(JSON.parse(rows[2]!.data!)).toEqual({ unserialisable: true });
  });

  it("keeps the request line when a handler floods the log, and accounts for the dropped lines", async () => {
    const s = await signup();
    const app = await freshApp();
    vi.spyOn(console, "log").mockImplementation(() => {});
    // The logger of the fresh module graph: the file-level import has its own request store.
    const { log } = await import("../src/logger.ts");
    app.get("/api/__flood", (c) => {
      for (let i = 0; i < 150; i++) log.info(`spam ${i}`);
      return c.json({ ok: true });
    });
    expect((await app.request("http://feedme2/api/__flood", authed(s.access), env)).status).toBe(200);

    const rows = await houseRows(s.houseId);
    expect(rows.filter((r) => r.msg.startsWith("spam "))).toHaveLength(99);
    expect(rows.filter((r) => r.msg === "request").map((r) => JSON.parse(r.data!).path)).toEqual(["/api/__flood"]);
    const dropped = rows.filter((r) => r.msg === "log lines dropped");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.level).toBe("warn");
    expect(JSON.parse(dropped[0]!.data!)).toEqual({ dropped: 51 });
  });

  it("sends lines logged after the flush to the console only", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const s = await signup();
    const sink = new D1Sink();
    const logger = new Logger("worker", [sink]);
    let pendingAfterLate = -1;
    await runWithRequestContext({ houseId: s.houseId, clientId: undefined }, async () => {
      logger.warn("before flush");
      await flushRequestLogs(db(env.DB), null);
      logger.error("late");
      pendingAfterLate = currentRequest()!.pending.length;
    });
    expect(pendingAfterLate).toBe(0);
    expect((await houseRows(s.houseId)).map((r) => r.msg)).toEqual(["before flush"]);
  });
});
