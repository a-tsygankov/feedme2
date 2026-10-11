import Dexie, { type EntityTable } from "dexie";
import type { FeedingCreate, FeedingPatch } from "@feedme2/shared";
import { authStore } from "./auth-store.ts";

export type OutboxOp =
  | { kind: "create"; feedingId: string; payload: FeedingCreate }
  | { kind: "patch"; feedingId: string; payload: FeedingPatch }
  | { kind: "delete"; feedingId: string; payload: null };

interface OutboxBase {
  seq?: number;
  feedingId: string;
  createdAt: number;
  /** The house that was signed in when the op was queued; a drain only sends the current house's rows. "" = queued
   * before rows carried a house (a v1 row migrated while signed out): the next house to drain adopts it. */
  houseId: string;
  /** Failed sends that were the op's own problem (5xx, 429, ...). Network loss does not count. */
  attempts: number;
  /** 1 = parked after too many attempts: kept for diagnosis, never sent again. A number, not a boolean, so it could be indexed. */
  dead?: 1;
}
export type OutboxRow =
  | (OutboxBase & { kind: "create"; payload: FeedingCreate })
  | (OutboxBase & { kind: "patch"; payload: FeedingPatch })
  | (OutboxBase & { kind: "delete"; payload: null });
export interface KvRow { key: string; value: string }

const signedInHouseId = (): string => {
  const s = authStore.getSnapshot();
  return s.status === "signedIn" ? s.house.id : "";
};

/** One IndexedDB for the install; the house's data is small. */
export class FeedmeDb extends Dexie {
  outbox!: EntityTable<OutboxRow, "seq">;
  kv!: EntityTable<KvRow, "key">;
  constructor(name = "feedme2", currentHouseId: () => string = signedInHouseId) {
    super(name);
    this.version(1).stores({ outbox: "++seq, feedingId", kv: "key" });
    // v2: ops are scoped to a house and count their failed attempts. Rows queued before this version belong to
    // whoever is signed in now (the only house that could have queued them on this phone), or "" if nobody is.
    this.version(2).stores({ outbox: "++seq, feedingId, houseId", kv: "key" }).upgrade((tx) => {
      const house = currentHouseId();
      return tx.table("outbox").toCollection().modify((row: { attempts?: number; houseId?: string }) => {
        row.attempts = 0;
        row.houseId = house;
      });
    });
  }
}

export const feedmeDb = new FeedmeDb();
