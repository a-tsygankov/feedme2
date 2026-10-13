import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { MAX_CATS, type Cat, type CatCreate, type CatPatch } from "@feedme2/shared";
import type { Db } from "../db/client.ts";
import { cats } from "../db/schema.ts";

type Row = typeof cats.$inferSelect;

export function toApiCat(r: Row): Cat {
  return {
    id: r.id,
    houseId: r.houseId,
    name: r.name,
    color: r.color as Cat["color"],
    avatarPose: r.avatarPose as Cat["avatarPose"],
    hungryAfterSec: r.hungryAfterSec,
    sortOrder: r.sortOrder,
    defaultAmountMg: r.defaultAmountMg,
    defaultEnteredUnit: r.defaultEnteredUnit,
    defaultEnteredValue: r.defaultEnteredValue,
    lastFedAt: r.lastFedAt,
    createdAt: r.createdAt,
    modifiedAt: r.modifiedAt,
  };
}

/** The D1 run() result carries the affected-row count in meta.changes. */
const changesOf = (res: unknown): number => (res as { meta?: { changes?: number } }).meta?.changes ?? 0;

const live = (houseId: string) => and(eq(cats.houseId, houseId), isNull(cats.deletedAt));

export class CatsRepo {
  constructor(private readonly db: Db) {}

  list(houseId: string): Promise<Row[]> {
    // id last so equal (sortOrder, createdAt) pairs still order deterministically.
    return this.db.query.cats.findMany({ where: live(houseId), orderBy: [asc(cats.sortOrder), asc(cats.createdAt), asc(cats.id)] });
  }

  listIncludingDeleted(houseId: string): Promise<Row[]> {
    // Reports keep a removed cat's history (spec §1.3); same order as list().
    return this.db.query.cats.findMany({ where: eq(cats.houseId, houseId), orderBy: [asc(cats.sortOrder), asc(cats.createdAt), asc(cats.id)] });
  }

  get(houseId: string, id: string): Promise<Row | undefined> {
    return this.db.query.cats.findFirst({ where: and(live(houseId), eq(cats.id, id)) });
  }

  /** Any row with this id, including a soft-deleted one (idempotency check). */
  getAny(id: string): Promise<Row | undefined> {
    return this.db.query.cats.findFirst({ where: eq(cats.id, id) });
  }

  /**
   * Which of `ids` are cats of this house, deleted or not. Feedings may
   * reference a soft-deleted cat (history stays reachable and an outbox
   * replay after a deletion must not fail), so this deliberately ignores
   * deleted_at. Chunked at 90 ids: D1 allows 100 bound parameters per
   * statement and the house id takes one.
   */
  async idsInHouse(houseId: string, ids: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < ids.length; i += 90) {
      const rows = await this.db
        .select({ id: cats.id })
        .from(cats)
        .where(and(eq(cats.houseId, houseId), inArray(cats.id, ids.slice(i, i + 90))));
      for (const r of rows) found.add(r.id);
    }
    return found;
  }

  /**
   * Inserts the cat unless the house already holds MAX_CATS live cats, in
   * which case it returns null. The cap check and the next sort_order
   * (max live + 1, so deleting a middle cat never causes a collision) live
   * in the same INSERT ... SELECT: D1 has no interactive transactions, and
   * a count-then-insert let concurrent requests slip past the cap or pick
   * the same sort_order. Throws the D1 UNIQUE error when the id already
   * exists in another house (the route maps it to 409).
   */
  async create(houseId: string, input: CatCreate, hungryAfterSecDefault: number, nowMs: number): Promise<Row | null> {
    const res = await this.db.run(sql`
      INSERT INTO cats (id, house_id, name, color, avatar_pose, hungry_after_sec, sort_order, created_at, modified_at)
      SELECT ${input.id}, ${houseId}, ${input.name}, ${input.color}, ${input.avatarPose}, ${input.hungryAfterSec ?? hungryAfterSecDefault},
        (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM cats WHERE house_id = ${houseId} AND deleted_at IS NULL),
        ${nowMs}, ${nowMs}
      WHERE (SELECT COUNT(*) FROM cats WHERE house_id = ${houseId} AND deleted_at IS NULL) < ${MAX_CATS}`);
    if (changesOf(res) === 0) return null;
    return (await this.get(houseId, input.id))!;
  }

  async update(houseId: string, id: string, patch: CatPatch, nowMs: number): Promise<Row | undefined> {
    await this.db.update(cats).set({ ...(patch as Partial<typeof cats.$inferInsert>), modifiedAt: nowMs }).where(and(live(houseId), eq(cats.id, id)));
    return this.get(houseId, id);
  }

  /**
   * Soft-deletes unless it would leave the house with no live cat. One
   * statement so two concurrent deletes of the last two cats cannot both
   * pass a separate count check. Returns whether a row changed; the caller
   * works out why not (missing, already deleted, or last cat).
   */
  async softDeleteUnlessLast(houseId: string, id: string, nowMs: number): Promise<boolean> {
    const res = await this.db.run(sql`
      UPDATE cats SET deleted_at = ${nowMs}, modified_at = ${nowMs}
      WHERE house_id = ${houseId} AND id = ${id} AND deleted_at IS NULL
        AND (SELECT COUNT(*) FROM cats WHERE house_id = ${houseId} AND deleted_at IS NULL) > 1`);
    return changesOf(res) > 0;
  }
}
