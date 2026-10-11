/**
 * Upload sink (spec §4.6): web log lines reach the house's persisted
 * feed so another phone's crash is visible in this phone's console.
 * Batches of <= 50 every 30 s while visible; errors flush at once (subject
 * to a 5 s..60 s backoff after a failed send, so a crash loop cannot hammer
 * a dead network); a failed batch is retried later.
 *
 * Signed out: nothing is sent, but the last SIGNED_OUT_KEEP lines are held in
 * a side buffer, because the lines that explain a failed sign-in or a boot
 * crash are logged before there is a session. `adoptSignedOutLines()` moves
 * them into the queue on the signedOut -> signedIn transition. The queue
 * itself belongs to one session: `clear()` (called from main.tsx's auth
 * subscription on sign-out or a house change) drops it at that moment, not at
 * the next flush, so lines of the old house can never ride on the new house's
 * token. `seed()` takes the logger's ring buffer once on attach, so lines
 * logged before the sink existed (module-load warnings) are not lost.
 *
 * Delivery is at-least-once: a request that timed out may still have been
 * stored by the server, and the retry then duplicates it. The console de-dupes
 * on (ts, source, level, msg, clientId).
 *
 * A page-hide flush (`keepalive`) sends exactly one chunk of at most
 * KEEPALIVE_MAX_BYTES, errors first and then the newest lines: browsers cap
 * the total body of in-flight keepalive requests at 64 KB and reject a
 * bigger one outright. The sink is NOT stopped on `pagehide`: a page restored
 * from the back/forward cache never runs its scripts again from the top, so a
 * stopped timer would silently end uploads for the rest of that page's life.
 *
 * This sink must never log through the Logger it drains: an upload
 * failure that wrote a log line would queue another upload. Its only
 * diagnostics go straight to `console.warn`.
 */
import type { LogEntry, LogSink, LogUploadEntry } from "@feedme2/shared";
import { ApiError } from "./api-client.ts";

export const UPLOAD_INTERVAL_MS = 30_000;
const BATCH = 50;
const MAX_QUEUE = 500;
const SIGNED_OUT_KEEP = 50;
const SEEN_KEEP = 1000;
export const KEEPALIVE_MAX_BYTES = 60 * 1024;
const BACKOFF_FIRST_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;
// Mirror of the server's LogEntrySchema.msg and LogsUploadBodySchema data caps. One
// over-long field makes the server reject the whole batch of 50, so shrink first.
const MAX_MSG = 500;
const MAX_DATA_BYTES = 1024;
// Headroom under the server's 1 KB so JSON escaping we mis-measure never tips a stack over the limit.
const TARGET_DATA_BYTES = 1000;

export interface FlushOptions {
  /** Page is going away: let the request outlive it. */
  keepalive?: boolean;
}

interface Deps {
  send: (batch: LogUploadEntry[], opts?: FlushOptions) => Promise<void>;
  isSignedIn: () => boolean;
  now: () => number;
  /** Returns a cancel function. Default in the app: `visibleInterval`. */
  schedule: (fn: () => void) => () => void;
}

export type UploadSink = LogSink & {
  flush(opts?: FlushOptions): Promise<void>;
  stop(): void;
  /** Drop everything queued or held for the session that just ended. */
  clear(): void;
  /** Take lines logged before the sink was attached (the logger's ring buffer). Safe to call more than once. */
  seed(entries: readonly LogEntry[]): void;
  /** Signed in now: queue what was logged while signed out. */
  adoptSignedOutLines(): void;
};

const encoder = new TextEncoder();
const byteLength = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;

/**
 * Fit `data` under the server's 1 KB. A crash's `stack` is the most useful thing in the whole line, so before giving
 * up (`{truncated:true}`) trim the longest string field until the rest fits.
 */
function fitData(data: Record<string, unknown>): Record<string, unknown> {
  try {
    if (byteLength(data) <= MAX_DATA_BYTES) return data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) return { truncated: true };
    const copy: Record<string, unknown> = { ...data };
    for (let i = 0; i < 64; i++) {
      const size = byteLength(copy);
      if (size <= TARGET_DATA_BYTES) return copy;
      let longest: string | null = null;
      for (const [k, v] of Object.entries(copy)) {
        if (typeof v === "string" && (longest === null || v.length > (copy[longest] as string).length)) longest = k;
      }
      if (longest === null) return { truncated: true };
      const value = copy[longest] as string;
      if (value.length === 0) return { truncated: true };
      // Characters are not bytes: convert the byte excess into characters at this value's own bytes-per-character
      // (at least one character, so the loop always progresses) and let the next round measure again.
      const perChar = Math.max(1, (byteLength(value) - 2) / value.length);
      const cut = Math.max(1, Math.ceil((size - TARGET_DATA_BYTES) / perChar));
      copy[longest] = value.slice(0, Math.max(0, value.length - cut));
    }
    return { truncated: true };
  } catch {
    return { truncated: true }; // circular or otherwise unserialisable
  }
}

function toUpload(entry: LogEntry): LogUploadEntry {
  const data = entry.data === undefined ? undefined : fitData(entry.data);
  return {
    ts: entry.ts,
    level: entry.level,
    msg: entry.msg.slice(0, MAX_MSG),
    ...(data !== undefined ? { data } : {}),
    ...(entry.clientId ? { clientId: entry.clientId } : {}),
  };
}

/** A 4xx means this batch is malformed or refused; retrying it forever would wedge the queue.
 * 408 and 429 are the exceptions: the batch is fine, the moment was not. */
function isPermanentRejection(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;
}

export function createUploadSink(deps: Deps): UploadSink {
  let queue: LogEntry[] = [];
  let signedOutLines: LogEntry[] = [];
  let flushing: Promise<void> | null = null;
  // Bumped by clear(): a send that was in flight for the old session must not touch the new one's queue.
  let epoch = 0;
  let nextAttemptAt = 0;
  let backoff = BACKOFF_FIRST_MS;
  const warned = new Set<number>();
  const seen = new Set<string>();

  const keyOf = (e: LogEntry) => `${e.ts}|${e.msg}`;
  function remember(e: LogEntry): void {
    seen.add(keyOf(e));
    if (seen.size > SEEN_KEEP) seen.delete(seen.values().next().value as string);
  }
  function enqueue(entry: LogEntry): void {
    queue.push(entry);
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  }
  function holdSignedOut(entry: LogEntry): void {
    signedOutLines.push(entry);
    if (signedOutLines.length > SIGNED_OUT_KEEP) signedOutLines = signedOutLines.slice(-SIGNED_OUT_KEEP);
  }
  /** Removes by identity: lines were appended (and the cap may have trimmed the head) while the request was in flight. */
  function drop(sent: readonly LogEntry[]): void {
    const gone = new Set(sent);
    queue = queue.filter((e) => !gone.has(e));
  }
  function succeeded(): void {
    nextAttemptAt = 0;
    backoff = BACKOFF_FIRST_MS;
  }
  function failed(): void {
    nextAttemptAt = deps.now() + backoff;
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
  }

  /** Errors first (the reason for the flush), then the newest of the rest, up to one keepalive-sized chunk. */
  function pickKeepaliveChunk(): LogEntry[] {
    const order = [
      ...queue.filter((e) => e.level === "error").reverse(),
      ...queue.filter((e) => e.level !== "error").reverse(),
    ];
    const chosen = new Set<LogEntry>();
    let bytes = 2; // the brackets
    for (const e of order) {
      if (chosen.size >= BATCH) break;
      const size = byteLength(toUpload(e)) + 1; // and a comma
      if (bytes + size > KEEPALIVE_MAX_BYTES) continue;
      chosen.add(e);
      bytes += size;
    }
    return queue.filter((e) => chosen.has(e)); // back to chronological order
  }

  const sink: UploadSink = {
    write(entry: LogEntry): void {
      remember(entry);
      if (!deps.isSignedIn()) {
        holdSignedOut(entry);
        return;
      }
      enqueue(entry);
      if (entry.level === "error" && deps.now() >= nextAttemptAt) void sink.flush();
    },
    seed(entries: readonly LogEntry[]): void {
      for (const entry of entries) {
        if (seen.has(keyOf(entry))) continue;
        remember(entry);
        if (deps.isSignedIn()) enqueue(entry);
        else holdSignedOut(entry);
      }
    },
    adoptSignedOutLines(): void {
      if (signedOutLines.length === 0) return;
      const held = signedOutLines;
      signedOutLines = [];
      queue = [...held, ...queue].slice(-MAX_QUEUE);
      if (held.some((e) => e.level === "error") && deps.now() >= nextAttemptAt) void sink.flush();
    },
    clear(): void {
      epoch++;
      queue = [];
      signedOutLines = [];
    },
    flush(opts?: FlushOptions): Promise<void> {
      if (flushing) {
        // A page-hide flush must not be swallowed by a request that may not survive the page: run it once that one ends.
        return opts?.keepalive ? flushing.then(() => sink.flush(opts)) : flushing;
      }
      if (queue.length === 0 || !deps.isSignedIn()) return Promise.resolve();
      const startedEpoch = epoch;
      const keepalive = opts?.keepalive === true;
      flushing = (async () => {
        while (queue.length > 0) {
          const batch = keepalive ? pickKeepaliveChunk() : queue.slice(0, BATCH);
          if (batch.length === 0) break;
          try {
            await deps.send(batch.map(toUpload), opts);
          } catch (err) {
            if (epoch !== startedEpoch) return; // the session ended while this was in flight
            if (isPermanentRejection(err)) {
              drop(batch);
              if (!warned.has(err.status)) {
                warned.add(err.status);
                console.warn(`log upload rejected (${err.status}); dropped ${batch.length} entries`);
              }
              if (keepalive) break;
              continue;
            }
            failed();
            break; // network or 5xx: keep the batch; the next timer retries
          }
          if (epoch !== startedEpoch) return;
          drop(batch);
          succeeded();
          if (keepalive || !deps.isSignedIn()) break;
        }
      })().finally(() => { flushing = null; });
      return flushing;
    },
    stop: deps.schedule(() => { void sink.flush(); }),
  };
  return sink;
}

/** Browser scheduler: every UPLOAD_INTERVAL_MS while the tab is visible. */
export function visibleInterval(fn: () => void): () => void {
  const id = window.setInterval(() => { if (document.visibilityState === "visible") fn(); }, UPLOAD_INTERVAL_MS);
  return () => window.clearInterval(id);
}
