/**
 * Upload sink (spec §4.6): web log lines reach the house's persisted
 * feed so another phone's crash is visible in this phone's console.
 * Batches of <= 50 every 30 s while visible; errors flush at once;
 * nothing is sent while signed out; a failed batch is retried later.
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
// Mirror of the server's LogEntrySchema.msg and LogsUploadBodySchema data caps. One
// over-long field makes the server reject the whole batch of 50, so shrink first.
const MAX_MSG = 500;
const MAX_DATA_BYTES = 1024;

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

export type UploadSink = LogSink & { flush(opts?: FlushOptions): Promise<void>; stop(): void };

const encoder = new TextEncoder();

function toUpload(entry: LogEntry): LogUploadEntry {
  let data = entry.data;
  if (data !== undefined) {
    try {
      if (encoder.encode(JSON.stringify(data)).length > MAX_DATA_BYTES) data = { truncated: true };
    } catch {
      data = { truncated: true }; // circular or otherwise unserialisable
    }
  }
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
  let flushing: Promise<void> | null = null;
  const warned = new Set<number>();

  const sink: UploadSink = {
    write(entry: LogEntry): void {
      if (!deps.isSignedIn()) return;
      queue.push(entry);
      if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
      if (entry.level === "error") void sink.flush();
    },
    flush(opts?: FlushOptions): Promise<void> {
      if (flushing) return flushing;
      if (queue.length === 0) return Promise.resolve();
      if (!deps.isSignedIn()) {
        // Entries queued under a session that has ended belong to that house, not the next one.
        queue = [];
        return Promise.resolve();
      }
      flushing = (async () => {
        while (queue.length > 0) {
          const batch = queue.slice(0, BATCH);
          try {
            await deps.send(batch.map(toUpload), opts);
            queue = queue.slice(batch.length);
          } catch (err) {
            if (isPermanentRejection(err)) {
              queue = queue.slice(batch.length);
              if (!warned.has(err.status)) {
                warned.add(err.status);
                console.warn(`log upload rejected (${err.status}); dropped ${batch.length} entries`);
              }
              continue;
            }
            break; // network or 5xx: keep the batch; the next timer retries
          }
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
