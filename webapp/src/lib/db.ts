import Dexie, { type EntityTable } from "dexie";
import type { FeedingCreate, FeedingPatch } from "@feedme2/shared";

export type OutboxOp =
  | { kind: "create"; feedingId: string; payload: FeedingCreate }
  | { kind: "patch"; feedingId: string; payload: FeedingPatch }
  | { kind: "delete"; feedingId: string; payload: null };

export interface OutboxRow { seq?: number; kind: OutboxOp["kind"]; feedingId: string; payload: unknown; createdAt: number }
export interface KvRow { key: string; value: string }

/** One IndexedDB for the install; the house's data is small. */
export class FeedmeDb extends Dexie {
  outbox!: EntityTable<OutboxRow, "seq">;
  kv!: EntityTable<KvRow, "key">;
  constructor(name = "feedme2") {
    super(name);
    this.version(1).stores({ outbox: "++seq, feedingId", kv: "key" });
  }
}

export const feedmeDb = new FeedmeDb();
