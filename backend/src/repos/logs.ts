import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DebugLogsQuery, LogEntry } from "@feedme2/shared";
import type { Db } from "../db/client.ts";
import { logEntries } from "../db/schema.ts";

export const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const LOG_ROWS_PER_HOUSE = 5000;
/** 10 bound columns per row; D1 allows 100 bound parameters per statement. */
const ROWS_PER_STATEMENT = 9;
export const MAX_MSG_CHARS = 500;
export const MAX_DATA_BYTES = 1024;
/** Client clocks lie: a stored ts outside this window is replaced by its edge. */
const TS_MAX_PAST_MS = LOG_RETENTION_MS;
const TS_MAX_FUTURE_MS = 5 * 60 * 1000;
/** Rows deleted per statement, and the most statements per prune call. */
export const PRUNE_CHUNK = 10_000;
const PRUNE_MAX_ROUNDS = 20;

/**
 * JSON for the data column, bounded: worker lines carry arbitrary error
 * text and uploads are only checked at the route, so the repo is the one
 * place every writer passes through. Circular or BigInt values must not
 * fail the whole batch; an oversized object is replaced by a marker that
 * says how big it was.
 */
function serialiseData(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  let json: string | undefined;
  try {
    json = JSON.stringify(data);
  } catch {
    return '{"unserialisable":true}';
  }
  if (json === undefined) return null;
  const bytes = new TextEncoder().encode(json).length;
  return bytes > MAX_DATA_BYTES ? JSON.stringify({ truncated: true, bytes }) : json;
}

export class LogsRepo {
  constructor(private readonly db: Db) {}

  async insertMany(
    houseId: string | null,
    entries: LogEntry[],
    origin: { clientId?: string; deviceId?: string },
    nowMs: number,
  ): Promise<void> {
    if (entries.length === 0) return;
    const rows = entries.map((e) => {
      // A device with a dead RTC (or a hostile client) must not be able to
      // park rows at ts=9e15, above every real line in a newest-first feed.
      const ts = Math.min(Math.max(e.ts, nowMs - TS_MAX_PAST_MS), nowMs + TS_MAX_FUTURE_MS);
      return {
        id: crypto.randomUUID(),
        houseId,
        source: e.source,
        deviceId: e.deviceId ?? origin.deviceId ?? null,
        clientId: e.clientId ?? origin.clientId ?? null,
        ts,
        level: e.level,
        msg: e.msg.slice(0, MAX_MSG_CHARS),
        data: serialiseData(ts === e.ts ? e.data : { ...e.data, rawTs: e.ts }),
        createdAt: nowMs,
      };
    });
    // A 50-entry upload is 500 parameters in one INSERT, which D1
    // rejects: split into statements and send them as one batch.
    const statements = [];
    for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
      statements.push(this.db.insert(logEntries).values(rows.slice(i, i + ROWS_PER_STATEMENT)));
    }
    await this.db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  }

  /**
   * Everything persisted for this house: worker lines written while
   * serving its authenticated requests, plus its web and device uploads.
   * Newest first. Rows with no house (public routes) are never returned.
   */
  async query(houseId: string, q: DebugLogsQuery): Promise<LogEntry[]> {
    const conds = [eq(logEntries.houseId, houseId)];
    if (q.source) conds.push(eq(logEntries.source, q.source));
    if (q.level) conds.push(eq(logEntries.level, q.level));
    if (q.device) conds.push(eq(logEntries.deviceId, q.device));
    if (q.since !== undefined) conds.push(gte(logEntries.ts, q.since));
    const rows = await this.db.query.logEntries.findMany({
      where: and(...conds),
      orderBy: [desc(logEntries.ts), desc(logEntries.createdAt)],
      limit: q.limit,
    });
    return rows.map((r) => ({
      ts: r.ts,
      level: r.level,
      source: r.source,
      msg: r.msg,
      ...(r.data ? { data: JSON.parse(r.data) as Record<string, unknown> } : {}),
      ...(r.deviceId ? { deviceId: r.deviceId } : {}),
      ...(r.clientId ? { clientId: r.clientId } : {}),
    }));
  }

  /**
   * Age cap, then per-house row cap (keep the newest 5 000). Both use
   * created_at, the server's clock: a client with a wrong clock can send
   * any `ts` and must not be able to dodge or trigger retention.
   * Rows with no house share one partition, so unauthenticated noise is
   * capped too.
   *
   * Each is one DELETE per round, limited to `chunk` ids, repeated until
   * a round removes nothing: a backlog (the cron was down, or a flood)
   * must not become one statement that exceeds D1's time limit. Rounds
   * are capped so the invocation stays under its subrequest budget; the
   * next hourly run carries on. The trim's window query scans the whole
   * table each round (there is no (house_id, created_at) index; adding
   * one needs a migration), which is acceptable at hourly cadence and
   * ~5 000 rows per house.
   */
  async prune(nowMs: number, chunk = PRUNE_CHUNK): Promise<number> {
    const cutoff = nowMs - LOG_RETENTION_MS;
    let removed = await this.deleteRounds(
      sql`DELETE FROM log_entries WHERE id IN (SELECT id FROM log_entries WHERE created_at < ${cutoff} LIMIT ${chunk})`,
      chunk,
    );
    removed += await this.deleteRounds(sql`
      DELETE FROM log_entries WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY house_id ORDER BY created_at DESC, id DESC) AS rn
          FROM log_entries
        ) WHERE rn > ${LOG_ROWS_PER_HOUSE} LIMIT ${chunk}
      )`, chunk);
    return removed;
  }

  private async deleteRounds(statement: ReturnType<typeof sql>, chunk: number): Promise<number> {
    let total = 0;
    for (let round = 0; round < PRUNE_MAX_ROUNDS; round++) {
      const res = await this.db.run(statement);
      const changes = res.meta.changes ?? 0;
      total += changes;
      // A short round means nothing is left: skip the extra empty statement.
      if (changes < chunk) break;
    }
    return total;
  }
}
