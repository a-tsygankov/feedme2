/**
 * Per-request store so the logger can queue worker entries during a
 * request and write them to D1 in one batch after the response, tagged
 * with the house that made it. Workers support AsyncLocalStorage under
 * the nodejs_compat flag (wrangler.toml).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { LogEntry } from "@feedme2/shared";
import type { Db } from "./db/client.ts";
import { LogsRepo } from "./repos/logs.ts";

export interface RequestStore {
  /** Set once the request's token is verified; null for public routes and rejected tokens. */
  houseId: string | null;
  pending: LogEntry[];
}

/** A runaway loop must not turn one request into an unbounded D1 write. */
export const MAX_PENDING_PER_REQUEST = 100;

const storage = new AsyncLocalStorage<RequestStore>();

export function runWithRequestContext<T>(houseId: string | null, fn: () => Promise<T>): Promise<T> {
  return storage.run({ houseId, pending: [] }, fn);
}

export function currentRequest(): RequestStore | undefined {
  return storage.getStore();
}

/**
 * Writes the current request's queued entries to D1. With an
 * ExecutionContext the write outlives the response (waitUntil); without
 * one (unit tests via app.request) it is awaited so it is not dropped.
 * A failed write never fails the request, and is reported on the console
 * only: logging it through the logger would just queue another write.
 */
export async function flushRequestLogs(d: Db, ctx: Pick<ExecutionContext, "waitUntil"> | null): Promise<void> {
  const store = currentRequest();
  if (!store || store.pending.length === 0) return;
  const entries = store.pending.splice(0);
  const write = new LogsRepo(d)
    .insertMany(store.houseId, entries, {}, Date.now())
    .catch((err: unknown) => console.error("log flush failed", err instanceof Error ? err.message : String(err)));
  if (ctx) ctx.waitUntil(write);
  else await write;
}
