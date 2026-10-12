import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { encodeFeedingsCursor, type Feeding, type FeedingCreate, type FeedingPatch } from "@feedme2/shared";
import type { Db } from "../db/client.ts";
import { cats, feedings } from "../db/schema.ts";
import type { CatsRepo } from "./cats.ts";

type Row = typeof feedings.$inferSelect;

export function toApiFeeding(r: Row): Feeding {
  return {
    id: r.id, houseId: r.houseId, catId: r.catId, fedAt: r.fedAt, amountMg: r.amountMg,
    enteredUnit: r.enteredUnit, enteredValue: r.enteredValue, source: r.source,
    deviceId: r.deviceId, clientId: r.clientId, note: r.note, createdAt: r.createdAt, modifiedAt: r.modifiedAt,
  };
}

export interface PageQuery {
  catId?: string;
  from?: number;
  to?: number;
  /** Exclusive upper bound on (fedAt, id): several cats can be fed in the same millisecond. */
  cursor?: { fedAt: number; id: string } | undefined;
  limit: number;
}

// D1 allows 100 bound parameters per statement. A feeding row binds 13
// (id, house, cat, fed_at, amount, unit, value, source, device, client, note,
// created, modified), so 7 rows = 91. A full 100-item POST (the schema max)
// otherwise fails with "too many SQL variables".
const INSERT_CHUNK_ROWS = 7;
// inArray() on ids binds one parameter each plus the house id (<= 91 of 100).
const LOOKUP_CHUNK = 90;

/** Who wrote the feedings: the web app (optionally tagged by a tab/client id) or a device. */
export type FeedingOrigin = { source: "web"; clientId: string | null } | { source: "device"; deviceId: string };

/**
 * The cat ids (distinct, first-seen order) that are NOT cats of this house.
 * A soft-deleted cat of the house counts as present: its row still satisfies
 * the composite FK, its history stays reachable, and an outbox replay made
 * after the cat was deleted must not poison the whole batch. Another house's
 * cat is reported exactly like a nonexistent one. Shared by the web route and
 * the Phase 2 device route.
 */
export async function assertCatsInHouse(catsRepo: CatsRepo, houseId: string, catIds: Iterable<string>): Promise<string[]> {
  const distinct = [...new Set(catIds)];
  const present = await catsRepo.idsInHouse(houseId, distinct);
  return distinct.filter((id) => !present.has(id));
}

export const FED_AT_MAX_FUTURE_MS = 5 * 60 * 1000;
/** Before this the device clock was never set (an RTC that came up at 1970): no real feeding is that old. */
export const FED_AT_UNSET_BEFORE_MS = Date.UTC(2020, 0, 1);
/**
 * Devices have no UI to fix a timestamp, so a wrong clock is corrected, not refused (web: fedat_in_future 400).
 * Only the clearly wrong is moved, to now: a future time, or one from before the clock was ever set. A device that
 * was offline for weeks syncs a real backlog, and rewriting those times to "now" would corrupt the feeding history.
 */
export function clampFedAt(fedAt: number, nowMs: number): { fedAt: number; clamped: boolean } {
  if (fedAt > nowMs + FED_AT_MAX_FUTURE_MS || fedAt < FED_AT_UNSET_BEFORE_MS) return { fedAt: nowMs, clamped: true };
  return { fedAt, clamped: false };
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export class FeedingsRepo {
  constructor(private readonly db: Db) {}

  async page(houseId: string, q: PageQuery): Promise<{ items: Row[]; nextCursor: string | null }> {
    const conds = [eq(feedings.houseId, houseId), isNull(feedings.deletedAt)];
    if (q.catId) conds.push(eq(feedings.catId, q.catId));
    if (q.from !== undefined) conds.push(gte(feedings.fedAt, q.from));
    if (q.to !== undefined) conds.push(lte(feedings.fedAt, q.to));
    if (q.cursor) {
      // Compound keyset: a bare `fed_at < ?` would skip every row that shares
      // the boundary row's fed_at (e.g. "feed all" writes one per cat).
      conds.push(or(lt(feedings.fedAt, q.cursor.fedAt), and(eq(feedings.fedAt, q.cursor.fedAt), lt(feedings.id, q.cursor.id)))!);
    }
    const rows = await this.db.query.feedings.findMany({
      where: and(...conds),
      orderBy: [desc(feedings.fedAt), desc(feedings.id)],
      limit: q.limit + 1,
    });
    const items = rows.slice(0, q.limit);
    const last = items[items.length - 1];
    const nextCursor = rows.length > q.limit && last ? encodeFeedingsCursor(last.fedAt, last.id) : null;
    return { items, nextCursor };
  }

  get(houseId: string, id: string): Promise<Row | undefined> {
    return this.db.query.feedings.findFirst({ where: and(eq(feedings.houseId, houseId), eq(feedings.id, id), isNull(feedings.deletedAt)) });
  }

  /** The feeding of this house with this id, soft-deleted or not (idempotent DELETE). */
  getAnyInHouse(houseId: string, id: string): Promise<Row | undefined> {
    return this.db.query.feedings.findFirst({ where: and(eq(feedings.houseId, houseId), eq(feedings.id, id)) });
  }

  /** Live feedings of this house among `ids`, in unspecified order. */
  async getMany(houseId: string, ids: string[]): Promise<Row[]> {
    const out: Row[] = [];
    for (const part of chunks(ids, LOOKUP_CHUNK)) {
      out.push(...(await this.db.query.feedings.findMany({
        where: and(eq(feedings.houseId, houseId), isNull(feedings.deletedAt), inArray(feedings.id, part)),
      })));
    }
    return out;
  }

  /**
   * Which of `ids` already exist as feedings of ANOTHER house (deleted or
   * not). The primary key is global, so such an id can never be written by
   * this house; the route turns it into a 409 instead of silently dropping it.
   */
  async idsOwnedByOtherHouses(houseId: string, ids: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const part of chunks(ids, LOOKUP_CHUNK)) {
      const rows = await this.db
        .select({ id: feedings.id })
        .from(feedings)
        .where(and(inArray(feedings.id, part), ne(feedings.houseId, houseId)));
      out.push(...rows.map((r) => r.id));
    }
    return out;
  }

  /**
   * Inserts the items whose id is new and returns the ids actually inserted.
   *
   * Chunked inserts and the cat-default refreshes go in ONE db.batch (D1 runs
   * a batch as a single transaction), so a failure part-way leaves neither
   * orphan feedings nor stale cat defaults. `accepted` comes from
   * `.returning({id})` on `ON CONFLICT DO NOTHING`: only rows really inserted
   * come back, so replays of an earlier batch (including of a soft-deleted
   * feeding: the row still exists, nothing is resurrected) are not accepted.
   *
   * The refreshes always run, even when nothing was accepted (a pure replay),
   * because a second batch would give up the all-or-nothing guarantee. They
   * are cheap no-ops then: the refresh only writes when a default actually
   * differs, so a replay does not bump cat.modified_at.
   *
   * Callers must have verified every catId belongs to the house
   * (assertCatsInHouse) and that no id belongs to another house.
   */
  async createMany(houseId: string, items: FeedingCreate[], origin: FeedingOrigin, nowMs: number): Promise<string[]> {
    const unique = items.filter((i, idx) => items.findIndex((j) => j.id === i.id) === idx);
    if (unique.length === 0) return [];
    const clientId = origin.source === "web" ? origin.clientId : null;
    const deviceId = origin.source === "device" ? origin.deviceId : null;
    const inserts = chunks(unique, INSERT_CHUNK_ROWS).map((part) =>
      this.db
        .insert(feedings)
        .values(
          part.map((i) => ({
            id: i.id, houseId, catId: i.catId, fedAt: i.fedAt, amountMg: i.amountMg, enteredUnit: i.enteredUnit,
            enteredValue: i.enteredValue, source: origin.source, deviceId, clientId,
            note: i.note ?? null, createdAt: nowMs, modifiedAt: nowMs,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: feedings.id }),
    );
    const catIds = [...new Set(unique.map((i) => i.catId))];
    const refreshes = catIds.map((catId) => this.catDefaultsStatement(houseId, catId, nowMs));
    const results = await this.db.batch([...inserts, ...refreshes] as unknown as [(typeof inserts)[number], ...(typeof inserts)[number][]]);
    return (results.slice(0, inserts.length) as Array<Array<{ id: string }>>).flat().map((r) => r.id);
  }

  /**
   * Patches a live feeding and refreshes the affected cats atomically.
   * Returns undefined when there is no live feeding to patch.
   *
   * Without a catId change no pre-read is needed: the refresh finds the
   * feeding's cat by subquery after the write (the same statement, so it
   * cannot go stale). A move needs the OLD cat, which is unknowable once the
   * row is rewritten, so it is read first and the write is guarded with
   * `cat_id = <that cat>`; if a concurrent request moved the feeding in
   * between, the guarded write matches nothing and we re-read and retry
   * rather than leave the intermediate cat's defaults stale.
   */
  async update(houseId: string, id: string, patch: FeedingPatch, nowMs: number): Promise<Row | undefined> {
    const set = { ...(patch as Partial<typeof feedings.$inferInsert>), modifiedAt: nowMs };
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = patch.catId ? await this.get(houseId, id) : undefined;
      if (patch.catId && !before) return undefined;
      const write = this.db
        .update(feedings)
        .set(set)
        .where(and(eq(feedings.houseId, houseId), eq(feedings.id, id), isNull(feedings.deletedAt), before ? eq(feedings.catId, before.catId) : undefined))
        .returning();
      const refreshes = before
        ? [...new Set([before.catId, patch.catId!])].map((catId) => this.catDefaultsStatement(houseId, catId, nowMs))
        : [this.catDefaultsStatement(houseId, this.catOfFeeding(houseId, id), nowMs)];
      const [rows] = (await this.db.batch([write, ...refreshes] as unknown as [typeof write, ...(typeof write)[]])) as unknown as [Row[]];
      if (rows[0]) return rows[0];
      if (!before) return undefined; // not live
    }
    throw new Error("feeding update lost the race three times");
  }

  /**
   * Soft-deletes a live feeding; returns false when there was none. The
   * refresh locates the cat through the (soft-deleted, still present) row, so
   * no pre-read is needed and the write and refresh share one transaction.
   */
  async softDelete(houseId: string, id: string, nowMs: number): Promise<boolean> {
    const write = this.db
      .update(feedings)
      .set({ deletedAt: nowMs, modifiedAt: nowMs })
      .where(and(eq(feedings.houseId, houseId), eq(feedings.id, id), isNull(feedings.deletedAt)))
      .returning({ id: feedings.id });
    const refresh = this.catDefaultsStatement(houseId, this.catOfFeeding(houseId, id), nowMs);
    const [rows] = (await this.db.batch([write, refresh] as unknown as [typeof write, typeof write])) as unknown as [Array<{ id: string }>];
    return rows.length > 0;
  }

  /** SQL for "the cat this feeding belongs to", valid before and after the feeding is soft-deleted. */
  private catOfFeeding(houseId: string, feedingId: string): SQL {
    return sql`(select cat_id from feedings where id = ${feedingId} and house_id = ${houseId})`;
  }

  /**
   * The cat row carries last_fed_at and the "default for next feeding"
   * (spec §1.5) so the device's single state read needs no join. Built as ONE
   * UPDATE with correlated subqueries (newest live feeding by fed_at desc,
   * id desc) instead of read-then-write, so it can sit after the feeding
   * write inside a db.batch and still see it.
   *
   * It only writes when one of the four values would change, so replays and
   * no-op edits (a note change) leave cats.modified_at alone. `is not` is the
   * null-safe inequality.
   */
  private catDefaultsStatement(houseId: string, cat: string | SQL, nowMs: number) {
    const latest = <T>(col: string) =>
      sql<T | null>`(select ${sql.raw(col)} from feedings where feedings.house_id = ${houseId} and feedings.cat_id = ${cat} and feedings.deleted_at is null order by feedings.fed_at desc, feedings.id desc limit 1)`;
    const lastFedAt = latest<number>("fed_at");
    const amountMg = latest<number>("amount_mg");
    const unit = latest<string>("entered_unit");
    const value = latest<string>("entered_value");
    return this.db
      .update(cats)
      .set({ lastFedAt, defaultAmountMg: amountMg, defaultEnteredUnit: unit, defaultEnteredValue: value, modifiedAt: nowMs })
      .where(
        and(
          eq(cats.houseId, houseId),
          typeof cat === "string" ? eq(cats.id, cat) : sql`${cats.id} = ${cat}`,
          or(
            sql`${cats.lastFedAt} is not ${lastFedAt}`,
            sql`${cats.defaultAmountMg} is not ${amountMg}`,
            sql`${cats.defaultEnteredUnit} is not ${unit}`,
            sql`${cats.defaultEnteredValue} is not ${value}`,
          ),
        ),
      );
  }
}
