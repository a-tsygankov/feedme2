/**
 * Feedings are the one thing a person must be able to log with no
 * network (spec §4.2). Writes go into the Dexie outbox first; this
 * engine drains it in order whenever the app is online and visible.
 * A network failure stops the drain and keeps the op. A 4xx other
 * than 401 drops the op (the server will never accept it) and logs
 * why. A 401 stops: the api client already tried a refresh.
 */
import type { EntityTable } from "dexie";
import type { FeedingCreate, FeedingPatch } from "@feedme2/shared";
import { api, ApiError } from "./api-client.ts";
import { feedmeDb, type OutboxOp, type OutboxRow } from "./db.ts";
import { appLog } from "./logger.ts";

export interface DrainResult { sent: number; dropped: number; stopped: boolean }
export type SyncStatus = "idle" | "syncing" | "offline" | "error";
export interface SyncSnapshot { pending: number; status: SyncStatus }

interface Deps {
  outbox: EntityTable<OutboxRow, "seq">;
  api: {
    createFeedings(items: FeedingCreate[]): Promise<unknown>;
    patchFeeding(id: string, patch: FeedingPatch): Promise<unknown>;
    deleteFeeding(id: string): Promise<unknown>;
  };
  now: () => number;
  log: { info(m: string, d?: Record<string, unknown>): void; warn(m: string, d?: Record<string, unknown>): void; error(m: string, d?: Record<string, unknown>): void };
}

export function createSyncEngine(deps: Deps) {
  let snapshot: SyncSnapshot = { pending: 0, status: "idle" };
  let draining: Promise<DrainResult> | null = null;
  const listeners = new Set<() => void>();
  const set = (s: Partial<SyncSnapshot>) => { snapshot = { ...snapshot, ...s }; for (const l of listeners) l(); };
  const refreshPending = async () => set({ pending: await deps.outbox.count() });
  void refreshPending();

  async function send(op: OutboxRow): Promise<void> {
    switch (op.kind) {
      case "create": await deps.api.createFeedings([op.payload as FeedingCreate]); return;
      case "patch": await deps.api.patchFeeding(op.feedingId, op.payload as FeedingPatch); return;
      case "delete": await deps.api.deleteFeeding(op.feedingId); return;
    }
  }

  async function drainOnce(): Promise<DrainResult> {
    set({ status: "syncing" });
    const result: DrainResult = { sent: 0, dropped: 0, stopped: false };
    const ops = await deps.outbox.orderBy("seq").toArray();
    for (const op of ops) {
      try {
        await send(op);
        await deps.outbox.delete(op.seq!);
        result.sent++;
      } catch (err) {
        if (err instanceof ApiError && err.status !== 401 && err.status < 500) {
          deps.log.error("sync op dropped", { kind: op.kind, feedingId: op.feedingId, status: err.status, body: err.body });
          await deps.outbox.delete(op.seq!);
          result.dropped++;
          continue;
        }
        result.stopped = true;
        break;
      }
    }
    await refreshPending();
    set({ status: result.stopped ? (snapshot.pending > 0 ? "offline" : "error") : "idle" });
    return result;
  }

  return {
    subscribe(l: () => void) { listeners.add(l); return () => void listeners.delete(l); },
    getSnapshot: () => snapshot,
    async enqueue(op: OutboxOp): Promise<void> {
      await deps.outbox.add({ kind: op.kind, feedingId: op.feedingId, payload: op.payload, createdAt: deps.now() });
      await refreshPending();
    },
    drain(): Promise<DrainResult> {
      if (draining) return draining;
      draining = drainOnce().finally(() => { draining = null; });
      return draining;
    },
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;

export const syncEngine: SyncEngine = createSyncEngine({ outbox: feedmeDb.outbox, api, now: Date.now, log: appLog });

/** Drain when connectivity or attention returns; call once at boot. */
export function startSyncTriggers(): void {
  const kick = () => { void syncEngine.drain(); };
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") kick(); });
  kick();
}
