import { SELF, env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { DebugLogsResponseSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index.ts";
import { db } from "../src/db/client.ts";
import { LogsRepo } from "../src/repos/logs.ts";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";

const DAY = 24 * 60 * 60 * 1000;

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

  it("web logs upload with a client id and show up in the house's debug feed", async () => {
    const s = await signup();
    const up = await s.fetchAuthed("/api/logs", {
      method: "POST",
      headers: { "x-client-id": "phone-1" },
      body: JSON.stringify([{ ts: 1_000, level: "error", msg: "kaboom", data: { stack: "x" } }]),
    });
    expect(up.status).toBe(202);
    const entries = await feed(s, "?source=web");
    expect(entries[0]).toMatchObject({ source: "web", level: "error", msg: "kaboom", clientId: "phone-1", data: { stack: "x" } });
  });

  it("the server stamps source=web: a forged source or deviceId is ignored", async () => {
    const s = await signup();
    const up = await s.fetchAuthed("/api/logs", {
      method: "POST",
      body: JSON.stringify([{ ts: 2_000, level: "info", source: "device", deviceId: "dev-x", msg: "forged" }]),
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
      body: JSON.stringify([{ ts: 3_000, level: "info", msg: "a", clientId: "entry" }]),
    });
    await s.fetchAuthed("/api/logs", { method: "POST", body: JSON.stringify([{ ts: 3_001, level: "info", msg: "b", clientId: "entry" }]) });
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
    const batch = Array.from({ length: 50 }, (_, i) => ({ ts: 10_000 + i, level: "info", msg: `bulk-${i}`, data: { i } }));
    expect((await s.fetchAuthed("/api/logs", { method: "POST", body: JSON.stringify(batch) })).status).toBe(202);
    expect(await feed(s, "?source=web&limit=500")).toHaveLength(50);
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

  it("filters by level and since; the debug route is house-scoped and needs a token", async () => {
    const s = await signup();
    await s.fetchAuthed("/api/logs", {
      method: "POST",
      body: JSON.stringify([
        { ts: 5_000, level: "info", msg: "old" },
        { ts: 9_000, level: "warn", msg: "new" },
      ]),
    });
    expect((await feed(s, "?level=warn")).map((e) => e.msg)).toEqual(["new"]);
    expect((await feed(s, "?source=web&since=6000")).map((e) => e.msg)).toEqual(["new"]);
    expect((await SELF.fetch("http://feedme2/api/debug/logs")).status).toBe(401);
  });

  it("the cron prunes by server time (created_at), not the client's ts, and drops expired refresh tokens", async () => {
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
    await runCron();
    const left = await env.DB.prepare("SELECT msg FROM log_entries WHERE house_id = ? AND source = 'web'").bind(s.houseId).all<{ msg: string }>();
    expect(left.results.map((r) => r.msg)).toEqual(["skewed-client-clock"]);
    const tokens = await env.DB.prepare("SELECT count(*) AS n FROM refresh_tokens WHERE house_id = ?").bind(s.houseId).first<{ n: number }>();
    expect(tokens?.n).toBe(0);
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
    await new LogsRepo(db(env.DB)).prune(Date.now());
    const kept = await env.DB.prepare("SELECT count(*) AS n, min(created_at) AS oldest FROM log_entries WHERE house_id = ? AND msg = 'bulk'")
      .bind(big.houseId)
      .first<{ n: number; oldest: number }>();
    expect(kept?.n).toBe(5000);
    expect(kept?.oldest).toBe(base + 11);
    const other = await env.DB.prepare("SELECT count(*) AS n FROM log_entries WHERE house_id = ? AND msg = 'mine'").bind(small.houseId).first<{ n: number }>();
    expect(other?.n).toBe(1);
  });
});
