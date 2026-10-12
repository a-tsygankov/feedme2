import { SELF, env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { DebugLogsResponseSchema } from "@feedme2/shared";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index.ts";
import { runHousekeeping } from "../src/cron.ts";
import { db } from "../src/db/client.ts";
import { LogsRepo } from "../src/repos/logs.ts";
import { RefreshTokensRepo } from "../src/repos/refresh-tokens.ts";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";

const DAY = 24 * 60 * 60 * 1000;
/** Client ts is clamped to [now - 7 d, now + 5 min] on insert, so fixtures use recent, relative values. */
const T0 = () => Date.now() - 3_600_000;

type Row = { level: string; msg: string; data: string | null; house_id: string | null; client_id: string | null; ts: number };
/** Rows tagged by a unique x-client-id: isolates one test's worker lines from the shared D1. */
async function rowsFor(clientId: string): Promise<Row[]> {
  const r = await env.DB.prepare("SELECT level, msg, data, house_id, client_id, ts FROM log_entries WHERE client_id = ? ORDER BY created_at, rowid")
    .bind(clientId)
    .all<Row>();
  return r.results;
}
const marker = () => `t-${crypto.randomUUID().slice(0, 12)}`;

async function feed(s: Awaited<ReturnType<typeof signup>>, qs = "") {
  return DebugLogsResponseSchema.parse(await (await s.fetchAuthed(`/api/debug/logs${qs}`)).json()).entries;
}

async function runCron() {
  const ctx = createExecutionContext();
  await worker.scheduled!({ scheduledTime: Date.now(), cron: "0 * * * *", noRetry() {} } as ScheduledController, env, ctx);
  await waitOnExecutionContext(ctx);
}

describe("logs", () => {
  beforeAll(applyAllMigrations);
  afterEach(() => vi.restoreAllMocks());

  it("web logs upload with a client id and show up in the house's debug feed", async () => {
    const s = await signup();
    const up = await s.fetchAuthed("/api/logs", {
      method: "POST",
      headers: { "x-client-id": "phone-1" },
      body: JSON.stringify([{ ts: T0(), level: "error", msg: "kaboom", data: { stack: "x" } }]),
    });
    expect(up.status).toBe(202);
    const entries = await feed(s, "?source=web");
    expect(entries[0]).toMatchObject({ source: "web", level: "error", msg: "kaboom", clientId: "phone-1", data: { stack: "x" } });
  });

  it("the server stamps source=web: a forged source or deviceId is ignored", async () => {
    const s = await signup();
    const up = await s.fetchAuthed("/api/logs", {
      method: "POST",
      body: JSON.stringify([{ ts: T0(), level: "info", source: "device", deviceId: "dev-x", msg: "forged" }]),
    });
    expect(up.status).toBe(202);
    const entries = await feed(s, "?source=web");
    expect(entries.map((e) => e.msg)).toEqual(["forged"]);
    expect(entries[0]!.deviceId).toBeUndefined();
    expect(await feed(s, "?source=device")).toEqual([]);
  });

  it("takes clientId from x-client-id, falling back to the entry's own", async () => {
    const s = await signup();
    await s.fetchAuthed("/api/logs", {
      method: "POST",
      headers: { "x-client-id": "hdr" },
      body: JSON.stringify([{ ts: T0(), level: "info", msg: "a", clientId: "entry" }]),
    });
    await s.fetchAuthed("/api/logs", { method: "POST", body: JSON.stringify([{ ts: T0() + 1, level: "info", msg: "b", clientId: "entry" }]) });
    const byMsg = Object.fromEntries((await feed(s, "?source=web")).map((e) => [e.msg, e.clientId]));
    expect(byMsg).toEqual({ a: "hdr", b: "entry" });
  });

  it("rejects an upload without a token, and a malformed one with 400", async () => {
    const s = await signup();
    expect((await SELF.fetch("http://feedme2/api/logs", { method: "POST", body: "[]" })).status).toBe(401);
    expect((await s.fetchAuthed("/api/logs", { method: "POST", body: JSON.stringify({ nope: true }) })).status).toBe(400);
  });

  it("stores a full 50-entry upload despite D1's 100-bound-parameter limit", async () => {
    const s = await signup();
    const batch = Array.from({ length: 50 }, (_, i) => ({ ts: T0() + i, level: "info", msg: `bulk-${i}`, data: { i } }));
    expect((await s.fetchAuthed("/api/logs", { method: "POST", body: JSON.stringify(batch) })).status).toBe(202);
    expect(await feed(s, "?source=web&limit=500")).toHaveLength(50);
  });

  it("rejects 51 entries with invalid_request, and multibyte data over 1 KB of UTF-8", async () => {
    const s = await signup();
    const fifty1 = Array.from({ length: 51 }, (_, i) => ({ ts: T0() + i, level: "info", msg: `m${i}` }));
    const tooMany = await s.fetchAuthed("/api/logs", { method: "POST", body: JSON.stringify(fifty1) });
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toMatchObject({ error: "invalid_request" });
    // 600 two-byte chars: under 1 024 UTF-16 units, over 1 024 bytes.
    const fat = await s.fetchAuthed("/api/logs", {
      method: "POST",
      body: JSON.stringify([{ ts: T0(), level: "info", msg: "fat", data: { s: "é".repeat(600) } }]),
    });
    expect(fat.status).toBe(400);
    expect(await fat.json()).toMatchObject({ error: "invalid_request" });
  });

  it("answers a 200 KB upload with 413 before parsing it", async () => {
    const s = await signup();
    const res = await s.fetchAuthed("/api/logs", {
      method: "POST",
      body: JSON.stringify([{ ts: T0(), level: "info", msg: "x".repeat(200 * 1024) }]),
    });
    expect(res.status).toBe(413);
  });

  it("clamps a client ts to [now - 7 d, now + 5 min] and keeps the original in data.rawTs", async () => {
    const s = await signup();
    const t = T0();
    const before = Date.now();
    await s.fetchAuthed("/api/logs", {
      method: "POST",
      body: JSON.stringify([
        { ts: 9e15, level: "info", msg: "far-future", data: { k: 1 } },
        { ts: 0, level: "info", msg: "epoch" },
        { ts: t, level: "info", msg: "sane" },
      ]),
    });
    const by = Object.fromEntries((await feed(s, "?source=web")).map((e) => [e.msg, e]));
    expect(by["far-future"]!.ts).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(by["far-future"]!.ts).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    expect(by["far-future"]!.data).toEqual({ k: 1, rawTs: 9e15 });
    expect(by.epoch!.ts).toBeGreaterThanOrEqual(before - 7 * DAY);
    expect(by.epoch!.ts).toBeLessThanOrEqual(Date.now() - 7 * DAY);
    expect(by.epoch!.data).toEqual({ rawTs: 0 });
    expect(by.sane!.ts).toBe(t);
    expect(by.sane!.data).toBeUndefined();
  });

  it("honours limit and orders equal ts by created_at, newest first", async () => {
    const s = await signup();
    const t = T0();
    const ins = env.DB.prepare("INSERT INTO log_entries (id, house_id, source, ts, level, msg, created_at) VALUES (?, ?, 'web', ?, 'info', ?, ?)");
    await env.DB.batch([
      ins.bind(crypto.randomUUID(), s.houseId, t, "first-in", t + 1),
      ins.bind(crypto.randomUUID(), s.houseId, t, "second-in", t + 2),
      ins.bind(crypto.randomUUID(), s.houseId, t, "third-in", t + 3),
    ]);
    expect((await feed(s, "?source=web")).map((e) => e.msg)).toEqual(["third-in", "second-in", "first-in"]);
    expect((await feed(s, "?source=web&limit=2")).map((e) => e.msg)).toEqual(["third-in", "second-in"]);
  });

  it("worker request lines are persisted for the authenticated house only, with its house id", async () => {
    const a = await signup();
    const b = await signup();
    await a.fetchAuthed("/api/cats");
    const aFeed = await feed(a, "?source=worker");
    expect(aFeed.some((e) => e.msg === "request" && (e.data as { path?: string }).path === "/api/cats")).toBe(true);
    const bFeed = await feed(b, "?source=worker");
    expect(bFeed.some((e) => (e.data as { path?: string }).path === "/api/cats")).toBe(false);
    const row = await env.DB.prepare("SELECT house_id FROM log_entries WHERE source = 'worker' AND msg = 'request' AND data LIKE '%/api/cats%' AND house_id = ?")
      .bind(a.houseId)
      .first<{ house_id: string }>();
    expect(row?.house_id).toBe(a.houseId);
  });

  it("persists a request row with the path only: no query string and no credentials anywhere in the row", async () => {
    const s = await signup();
    const cid = marker();
    await s.fetchAuthed("/api/cats?pin=1234", { headers: { "x-client-id": cid } });
    const rows = await rowsFor(cid);
    const req = rows.find((r) => r.msg === "request");
    expect(JSON.parse(req!.data!)).toMatchObject({ method: "GET", path: "/api/cats", status: 200 });
    const dump = JSON.stringify(rows).toLowerCase();
    expect(dump).not.toContain("authorization");
    expect(dump).not.toContain("bearer");
    expect(dump).not.toContain(s.access.toLowerCase());
    expect(dump).not.toContain("pin=1234");
  });

  it("stamps worker rows with the validated x-client-id; a malformed one is ignored", async () => {
    const s = await signup();
    const cid = marker();
    await s.fetchAuthed("/api/cats", { headers: { "x-client-id": cid } });
    const stamped = (await feed(s, "?source=worker&limit=500")).filter((e) => e.clientId === cid);
    expect(stamped.some((e) => e.msg === "request")).toBe(true);

    await s.fetchAuthed("/api/cats", { headers: { "x-client-id": "bad id; drop table" } });
    const all = await feed(s, "?source=worker&limit=500");
    expect(all.filter((e) => e.clientId === "bad id; drop table")).toEqual([]);
    expect(all.filter((e) => e.clientId === undefined).length).toBeGreaterThan(0);
  });

  it("filters by level and since; the debug route is house-scoped and needs a token", async () => {
    const s = await signup();
    const t = T0();
    await s.fetchAuthed("/api/logs", {
      method: "POST",
      body: JSON.stringify([
        { ts: t, level: "info", msg: "old" },
        { ts: t + 4_000, level: "warn", msg: "new" },
      ]),
    });
    expect((await feed(s, "?level=warn")).map((e) => e.msg)).toEqual(["new"]);
    expect((await feed(s, `?source=web&since=${t + 1_000}`)).map((e) => e.msg)).toEqual(["new"]);
    expect((await SELF.fetch("http://feedme2/api/debug/logs")).status).toBe(401);
  });

  describe("anonymous traffic writes no rows unless it produced a warn or error", () => {
    it("a 404 and /api/version leave nothing behind", async () => {
      const cid = marker();
      expect((await SELF.fetch("http://feedme2/api/nope", { headers: { "x-client-id": cid } })).status).toBe(404);
      expect((await SELF.fetch("http://feedme2/api/version", { headers: { "x-client-id": cid } })).status).toBe(200);
      expect(await rowsFor(cid)).toEqual([]);
    });

    it("malformed JSON still writes its one warn", async () => {
      const cid = marker();
      const res = await SELF.fetch("http://feedme2/api/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-id": cid },
        body: "{not json",
      });
      expect(res.status).toBe(400);
      const rows = await rowsFor(cid);
      expect(rows.map((r) => [r.level, r.msg, r.house_id])).toEqual([["warn", "request failed", null]]);
    });
  });

  it("flushes through waitUntil in production: the row appears once the execution context settles", async () => {
    const s = await signup();
    const cid = marker();
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://feedme2/api/cats", { headers: { authorization: `Bearer ${s.access}`, "x-client-id": cid } }),
      { ...env, ENVIRONMENT: "production" },
      ctx,
    );
    expect(res.status).toBe(200);
    await waitOnExecutionContext(ctx);
    expect((await rowsFor(cid)).map((r) => r.msg)).toEqual(["request"]);
  });

  it("the cron prunes by server time (created_at), not the client's ts, and drops expired refresh tokens and expired pairings", async () => {
    const s = await signup();
    const now = Date.now();
    const old = now - 8 * DAY;
    const ins = env.DB.prepare("INSERT INTO log_entries (id, house_id, source, ts, level, msg, created_at) VALUES (?, ?, 'web', ?, 'info', ?, ?)");
    await env.DB.batch([
      // Received 8 days ago, client clock says now: gone.
      ins.bind(crypto.randomUUID(), s.houseId, now, "stale-by-server-time", old),
      // Received now from a client whose clock is 8 days behind: kept.
      ins.bind(crypto.randomUUID(), s.houseId, old, "skewed-client-clock", now),
    ]);
    await env.DB.prepare("UPDATE refresh_tokens SET expires_at = 1 WHERE house_id = ?").bind(s.houseId).run();
    // One pairing past its 10 minutes (it still holds a plaintext token), one fresh.
    const pair = env.DB.prepare("INSERT INTO pending_pairings (device_id, pair_code, hw_model, fw_version, requested_at, expires_at, poll_secret_hash) VALUES (?, ?, 'device-sim', '0.2.0', ?, ?, 'h')");
    const stale = "a".repeat(32);
    const fresh = "b".repeat(32);
    await env.DB.batch([pair.bind(stale, "100001", now - 20 * 60_000, now - 10 * 60_000), pair.bind(fresh, "100002", now, now + 10 * 60_000)]);
    await runCron();
    const pairs = await env.DB.prepare("SELECT device_id FROM pending_pairings WHERE device_id IN (?, ?)").bind(stale, fresh).all<{ device_id: string }>();
    expect(pairs.results.map((r) => r.device_id)).toEqual([fresh]);
    const left = await env.DB.prepare("SELECT msg FROM log_entries WHERE house_id = ? AND source = 'web'").bind(s.houseId).all<{ msg: string }>();
    expect(left.results.map((r) => r.msg)).toEqual(["skewed-client-clock"]);
    const tokens = await env.DB.prepare("SELECT count(*) AS n FROM refresh_tokens WHERE house_id = ?").bind(s.houseId).first<{ n: number }>();
    expect(tokens?.n).toBe(0);
  });

  it("the cron still prunes tokens when the log prune throws, then rethrows", async () => {
    vi.spyOn(LogsRepo.prototype, "prune").mockRejectedValueOnce(new Error("log prune broke"));
    const tokens = vi.spyOn(RefreshTokensRepo.prototype, "pruneExpired");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runHousekeeping(env)).rejects.toThrow("log prune broke");
    expect(tokens).toHaveBeenCalledTimes(1);
  });

  it("prune deletes aged rows in chunks until none are left", async () => {
    const s = await signup();
    const old = Date.now() - 8 * DAY;
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 25)
       INSERT INTO log_entries (id, house_id, source, ts, level, msg, created_at)
       SELECT lower(hex(randomblob(8))), ?, 'web', ?, 'info', 'aged-chunk', ? + i FROM n`,
    )
      .bind(s.houseId, Date.now(), old)
      .run();
    const removed = await new LogsRepo(db(env.DB)).prune(Date.now(), 10);
    expect(removed).toBeGreaterThanOrEqual(25);
    const left = await env.DB.prepare("SELECT count(*) AS n FROM log_entries WHERE msg = 'aged-chunk'").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it("prune stops a loop as soon as a round deletes fewer rows than the chunk", async () => {
    const s = await signup();
    const old = Date.now() - 8 * DAY;
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 25)
       INSERT INTO log_entries (id, house_id, source, ts, level, msg, created_at)
       SELECT lower(hex(randomblob(8))), ?, 'web', ?, 'info', 'aged-rounds', ? + i FROM n`,
    )
      .bind(s.houseId, Date.now(), old)
      .run();
    const d = db(env.DB);
    const run = vi.spyOn(d, "run");
    await new LogsRepo(d).prune(Date.now(), 10);
    // Age loop: 10, 10, 5 (short, stop). Row-cap loop: nothing over the cap, one short round, stop.
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("prune keeps each house's newest 5 000 rows by created_at and leaves other houses alone", async () => {
    const big = await signup();
    const small = await signup();
    const base = Date.now() - 60_000;
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5010)
       INSERT INTO log_entries (id, house_id, source, ts, level, msg, created_at)
       SELECT lower(hex(randomblob(8))), ?, 'web', ?, 'info', 'bulk', ? + i FROM n`,
    )
      .bind(big.houseId, base, base)
      .run();
    await env.DB.prepare("INSERT INTO log_entries (id, house_id, source, ts, level, msg, created_at) VALUES (?, ?, 'web', ?, 'info', 'mine', ?)")
      .bind(crypto.randomUUID(), small.houseId, base, base)
      .run();
    // Chunk of 4: the 10 surplus rows go in three deletes (4, 4, 2) plus the empty one that ends the loop.
    await new LogsRepo(db(env.DB)).prune(Date.now(), 4);
    const kept = await env.DB.prepare("SELECT count(*) AS n, min(created_at) AS oldest FROM log_entries WHERE house_id = ? AND msg = 'bulk'")
      .bind(big.houseId)
      .first<{ n: number; oldest: number }>();
    expect(kept?.n).toBe(5000);
    expect(kept?.oldest).toBe(base + 11);
    const other = await env.DB.prepare("SELECT count(*) AS n FROM log_entries WHERE house_id = ? AND msg = 'mine'").bind(small.houseId).first<{ n: number }>();
    expect(other?.n).toBe(1);
  });
});
