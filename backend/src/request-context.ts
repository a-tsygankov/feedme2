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
  /** The caller's x-client-id when it is well-formed, so worker rows can be correlated with its web uploads. */
  clientId: string | undefined;
  /** Set by setRequestOrigin for a verified device request, so the console's device filter shows the worker lines a device caused. */
  deviceId: string | undefined;
  pending: LogEntry[];
  /** Handler lines refused by the cap; reported as one warn line at flush so a flood is visible, not silent. */
  dropped: number;
  /** Set when the request line is about to be logged: it is exempt from the cap (it is the one line that matters most). */
  finalising: boolean;
  /** Set at flush; lines logged after it (waitUntil work) go to the console only. */
  flushed: boolean;
}

/** Handler lines per request. One slot more is reserved for the request line itself. */
export const MAX_HANDLER_LINES = 99;

/** Same shape the web client generates; anything else is ignored rather than stored. */
const CLIENT_ID = /^[\w-]{1,64}$/;
export function parseClientId(raw: string | undefined | null): string | undefined {
  return raw && CLIENT_ID.test(raw) ? raw : undefined;
}

const storage = new AsyncLocalStorage<RequestStore>();

export function runWithRequestContext<T>(origin: { houseId: string | null; clientId?: string | undefined; deviceId?: string | undefined }, fn: () => Promise<T>): Promise<T> {
  return storage.run(
    { houseId: origin.houseId, clientId: origin.clientId, deviceId: origin.deviceId, pending: [], dropped: 0, finalising: false, flushed: false },
    fn,
  );
}

export function currentRequest(): RequestStore | undefined {
  return storage.getStore();
}

/**
 * Attributes the current request to a house (and device) after the caller has
 * verified more than a signature. requireDevice calls this once the devices row
 * says the token is still welcome: a revoked or replaced device's token still
 * carries a valid signature, and attributing on that alone would let it keep
 * writing rows into the house's log feed. A no-op outside a request.
 */
export function setRequestOrigin(origin: { houseId: string; deviceId?: string | undefined }): void {
  const store = storage.getStore();
  if (!store) return;
  store.houseId = origin.houseId;
  store.deviceId = origin.deviceId;
}

/**
 * Queues one entry on the current request. A runaway loop must not turn
 * one request into an unbounded D1 write, so handler lines are capped;
 * the overflow is counted, never silently lost. Returns false when the
 * entry was not queued (no request, already flushed, or over the cap).
 */
export function queueLogEntry(entry: LogEntry): boolean {
  const store = currentRequest();
  if (!store || store.flushed) return false;
  if (!store.finalising && store.pending.length >= MAX_HANDLER_LINES) {
    store.dropped++;
    return false;
  }
  store.pending.push(entry);
  return true;
}

/** Called just before the request line is logged so the cap cannot evict it. */
export function beginFinalLine(): void {
  const store = currentRequest();
  if (store) store.finalising = true;
}

/**
 * Writes the current request's queued entries to D1. With an
 * ExecutionContext the write outlives the response (waitUntil); without
 * one (unit tests via app.request) it is awaited so it is not dropped.
 * A failed write never fails the request, and is reported on the console
 * only: logging it through the logger would just queue another write.
 *
 * Anonymous requests (no valid token) persist only warn and error lines:
 * anyone on the internet can send them, nobody can read them back, and
 * each persisted line is a D1 write. The console still gets everything.
 */
export async function flushRequestLogs(d: Db, ctx: Pick<ExecutionContext, "waitUntil"> | null): Promise<void> {
  const store = currentRequest();
  if (!store || store.flushed) return;
  let entries = store.pending.splice(0);
  store.flushed = true;
  if (store.dropped > 0) {
    entries.push({ ts: Date.now(), level: "warn", source: "worker", msg: "log lines dropped", data: { dropped: store.dropped } });
  }
  if (store.houseId === null) entries = entries.filter((e) => e.level === "warn" || e.level === "error");
  if (entries.length === 0) return;
  const write = new LogsRepo(d)
    .insertMany(store.houseId, entries, { ...(store.clientId ? { clientId: store.clientId } : {}), ...(store.deviceId ? { deviceId: store.deviceId } : {}) }, Date.now())
    .catch((err: unknown) => console.error("log flush failed", err instanceof Error ? err.message : String(err)));
  if (ctx) ctx.waitUntil(write);
  else await write;
}
