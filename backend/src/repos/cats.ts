import { and, asc, count, eq, isNull } from "drizzle-orm";
import type { Cat, CatCreate, CatPatch } from "@feedme2/shared";
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

const live = (houseId: string) => and(eq(cats.houseId, houseId), isNull(cats.deletedAt));

export class CatsRepo {
  constructor(private readonly db: Db) {}

  list(houseId: string): Promise<Row[]> {
    return this.db.query.cats.findMany({ where: live(houseId), orderBy: [asc(cats.sortOrder), asc(cats.createdAt)] });
  }

  get(houseId: string, id: string): Promise<Row | undefined> {
    return this.db.query.cats.findFirst({ where: and(live(houseId), eq(cats.id, id)) });
  }

  /** Any row with this id, including a soft-deleted one (idempotency check). */
  getAny(id: string): Promise<Row | undefined> {
    return this.db.query.cats.findFirst({ where: eq(cats.id, id) });
  }

  async countLive(houseId: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(cats).where(live(houseId));
    return row?.n ?? 0;
  }

  async create(houseId: string, input: CatCreate, hungryAfterSecDefault: number, nowMs: number): Promise<Row> {
    const n = await this.countLive(houseId);
    await this.db.insert(cats).values({
      id: input.id,
      houseId,
      name: input.name,
      color: input.color,
      avatarPose: input.avatarPose,
      hungryAfterSec: input.hungryAfterSec ?? hungryAfterSecDefault,
      sortOrder: n,
      createdAt: nowMs,
      modifiedAt: nowMs,
    });
    return (await this.get(houseId, input.id))!;
  }

  async update(houseId: string, id: string, patch: CatPatch, nowMs: number): Promise<Row | undefined> {
    await this.db.update(cats).set({ ...(patch as Partial<typeof cats.$inferInsert>), modifiedAt: nowMs }).where(and(live(houseId), eq(cats.id, id)));
    return this.get(houseId, id);
  }

  async softDelete(houseId: string, id: string, nowMs: number): Promise<void> {
    await this.db.update(cats).set({ deletedAt: nowMs, modifiedAt: nowMs }).where(and(live(houseId), eq(cats.id, id)));
  }
}
