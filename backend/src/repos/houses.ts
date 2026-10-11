import { and, eq, isNull } from "drizzle-orm";
import type { House, HousePatch } from "@feedme2/shared";
import type { Db } from "../db/client.ts";
import { houses } from "../db/schema.ts";
import { hashPin } from "../auth/pin.ts";

type Row = typeof houses.$inferSelect;

export function toApiHouse(r: Row): House {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    modifiedAt: r.modifiedAt,
    settings: {
      foodUnit: r.foodUnit,
      canSizeMg: r.canSizeMg,
      canFractionStep: r.canFractionStep,
      gramStep: r.gramStep as 1 | 5 | 10,
      ozStepHundredths: r.ozStepHundredths as 25 | 50,
      hungryAfterSecDefault: r.hungryAfterSecDefault,
      sleepTimeoutSec: r.sleepTimeoutSec,
      syncIntervalSec: r.syncIntervalSec,
      timezone: r.timezone,
    },
  };
}

/**
 * The display form of a house name: NFKC so visually identical spellings
 * (precomposed "é" vs "e" + combining accent, full-width letters) are one
 * string, with inner whitespace runs collapsed.
 */
export const normalizeHouseName = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ");

/** Uniqueness key: case-insensitive on top of the normalised name. */
export const nameKey = (name: string) => normalizeHouseName(name).toLowerCase();

export class HousesRepo {
  constructor(private readonly db: Db) {}

  async findByName(name: string): Promise<Row | undefined> {
    return this.db.query.houses.findFirst({ where: and(eq(houses.nameKey, nameKey(name)), isNull(houses.deletedAt)) });
  }

  async findById(id: string): Promise<Row | undefined> {
    return this.db.query.houses.findFirst({ where: and(eq(houses.id, id), isNull(houses.deletedAt)) });
  }

  /** Throws the D1 UNIQUE error when the name is taken; the route maps it to 409. */
  async create(name: string, pin: string | null, nowMs: number): Promise<Row> {
    const { salt, hash } = pin === null ? { salt: "", hash: "" } : await hashPin(pin);
    const id = crypto.randomUUID();
    await this.db.insert(houses).values({
      id, name: normalizeHouseName(name), nameKey: nameKey(name), pinSalt: salt, pinHash: hash, createdAt: nowMs, modifiedAt: nowMs,
    });
    return (await this.findById(id))!;
  }

  async updateSettings(id: string, patch: HousePatch, nowMs: number): Promise<Row> {
    const { name, ...settings } = patch;
    await this.db
      .update(houses)
      .set({ ...(settings as Partial<typeof houses.$inferInsert>), ...(name !== undefined ? { name: normalizeHouseName(name), nameKey: nameKey(name) } : {}), modifiedAt: nowMs })
      .where(eq(houses.id, id));
    return (await this.findById(id))!;
  }

  async setPin(id: string, pin: string, nowMs: number): Promise<void> {
    const { salt, hash } = await hashPin(pin);
    await this.db.update(houses).set({ pinSalt: salt, pinHash: hash, modifiedAt: nowMs }).where(eq(houses.id, id));
  }
}
