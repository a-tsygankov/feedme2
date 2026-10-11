import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { DebugLogsQuery, LogEntry } from "@feedme2/shared";
import type { Db } from "../db/client.ts";
import { logEntries } from "../db/schema.ts";

export const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const LOG_ROWS_PER_HOUSE = 5000;
/** 10 bound columns per row; D1 allows 100 bound parameters per statement. */
const ROWS_PER_STATEMENT = 9;

export class LogsRepo {
  constructor(private readonly db: Db) {}

  async insertMany(
    houseId: string | null,
    entries: LogEntry[],
    origin: { clientId?: string; deviceId?: string },
    nowMs: number,
  ): Promise<void> {
    if (entries.length === 0) return;
    const rows = entries.map((e) => ({
      id: crypto.randomUUID(),
      houseId,
      source: e.source,
      deviceId: e.deviceId ?? origin.deviceId ?? null,
      clientId: e.clientId ?? origin.clientId ?? null,
      ts: e.ts,
      level: e.level,
      msg: e.msg,
      data: e.data ? JSON.stringify(e.data) : null,
      createdAt: nowMs,
    }));
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
   * capped too. One statement each, so there is no id list to chunk.
   */
  async prune(nowMs: number): Promise<number> {
    const aged = await this.db.delete(logEntries).where(lt(logEntries.createdAt, nowMs - LOG_RETENTION_MS));
    const overflow = await this.db.run(sql`
      DELETE FROM log_entries WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY house_id ORDER BY created_at DESC, id DESC) AS rn
          FROM log_entries
        ) WHERE rn > ${LOG_ROWS_PER_HOUSE}
      )`);
    return aged.meta.changes + (overflow.meta.changes ?? 0);
  }
}
