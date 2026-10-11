import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { encodeFeedingsCursor, type Feeding, type FeedingCreate, type FeedingPatch } from "@feedme2/shared";
import type { Db } from "../db/client.ts";
import { cats, feedings } from "../db/schema.ts";

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
// inArray() on ids binds one parameter each plus the house id.
const LOOKUP_CHUNK = 50;

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
   * Inserts the items whose id is new and returns the ids actually inserted.
   *
   * Chunked inserts and the cat-default refreshes go in ONE db.batch (D1 runs
   * a batch as a single transaction), so a failure part-way leaves neither
   * orphan feedings nor stale cat defaults. `accepted` comes from
   * `.returning({id})` on `ON CONFLICT DO NOTHING`: only rows really inserted
   * come back, which also covers an id that already exists in another house
   * (ignored, never leaked) and replays of an earlier batch.
   *
   * Callers must have verified every catId belongs to the house.
   */
  async createMany(
    houseId: string,
    items: FeedingCreate[],
    source: "web" | "device",
    origin: { clientId?: string; deviceId?: string },
    nowMs: number,
  ): Promise<string[]> {
    const unique = items.filter((i, idx) => items.findIndex((j) => j.id === i.id) === idx);
    if (unique.length === 0) return [];
    const inserts = chunks(unique, INSERT_CHUNK_ROWS).map((part) =>
      this.db
        .insert(feedings)
        .values(
          part.map((i) => ({
            id: i.id, houseId, catId: i.catId, fedAt: i.fedAt, amountMg: i.amountMg, enteredUnit: i.enteredUnit,
            enteredValue: i.enteredValue, source, deviceId: origin.deviceId ?? null, clientId: origin.clientId ?? null,
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

  /** Patches a live feeding and refreshes the affected cats atomically. */
  async update(houseId: string, id: string, patch: FeedingPatch, nowMs: number): Promise<Row | undefined> {
    const before = await this.get(houseId, id);
    if (!before) return undefined;
    const write = this.db
      .update(feedings)
      .set({ ...(patch as Partial<typeof feedings.$inferInsert>), modifiedAt: nowMs })
      .where(and(eq(feedings.houseId, houseId), eq(feedings.id, id), isNull(feedings.deletedAt)));
    const catIds = new Set([before.catId]);
    if (patch.catId) catIds.add(patch.catId);
    const refreshes = [...catIds].map((catId) => this.catDefaultsStatement(houseId, catId, nowMs));
    await this.db.batch([write, ...refreshes] as unknown as [typeof write, ...(typeof write)[]]);
    return this.get(houseId, id);
  }

  /** Returns false when there was no live feeding to delete. */
  async softDelete(houseId: string, id: string, nowMs: number): Promise<boolean> {
    const before = await this.get(houseId, id);
    if (!before) return false;
    const write = this.db
      .update(feedings)
      .set({ deletedAt: nowMs, modifiedAt: nowMs })
      .where(and(eq(feedings.houseId, houseId), eq(feedings.id, id), isNull(feedings.deletedAt)));
    const refresh = this.catDefaultsStatement(houseId, before.catId, nowMs);
    await this.db.batch([write, refresh] as unknown as [typeof write, (typeof write)]);
    return true;
  }

  /** Standalone recompute; the write paths above fold the same statement into their batch. */
  async refreshCatDefaults(houseId: string, catId: string, nowMs: number): Promise<void> {
    await this.catDefaultsStatement(houseId, catId, nowMs);
  }

  /**
   * The cat row carries last_fed_at and the "default for next feeding"
   * (spec §1.5) so the device's single state read needs no join. Built as ONE
   * UPDATE with correlated subqueries (newest live feeding by fed_at desc,
   * id desc) instead of read-then-write, so it can sit after the feeding
   * write inside a db.batch and still see it.
   */
  private catDefaultsStatement(houseId: string, catId: string, nowMs: number) {
    const latest = <T>(col: unknown) =>
      sql<T | null>`(select ${col} from ${feedings} where ${feedings.houseId} = ${houseId} and ${feedings.catId} = ${catId} and ${feedings.deletedAt} is null order by ${feedings.fedAt} desc, ${feedings.id} desc limit 1)`;
    return this.db
      .update(cats)
      .set({
        lastFedAt: latest<number>(sql.raw("fed_at")),
        defaultAmountMg: latest<number>(sql.raw("amount_mg")),
        defaultEnteredUnit: latest<string>(sql.raw("entered_unit")),
        defaultEnteredValue: latest<string>(sql.raw("entered_value")),
        modifiedAt: nowMs,
      })
      .where(and(eq(cats.houseId, houseId), eq(cats.id, catId)));
  }
}
