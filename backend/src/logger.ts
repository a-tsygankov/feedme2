/**
 * Structured logging with pluggable sinks. The app-wide singleton
 * writes to the console (Workers Logs ingests it) AND queues each entry
 * on the current request, which the request middleware flushes to D1
 * after the response (spec D10). /api/debug/logs reads those rows.
 */
import { Logger, type LogEntry, type LogSink } from "@feedme2/shared";
import { MAX_PENDING_PER_REQUEST, currentRequest } from "./request-context.ts";

export { Logger };
export type { LogSink };

export class ConsoleSink implements LogSink {
  write(entry: LogEntry): void {
    // An object, not JSON.stringify(entry): Workers Logs indexes the
    // fields of an object argument, but a string argument becomes one
    // opaque `message` and ts/level/data stop being searchable.
    if (entry.level === "error") console.error(entry);
    else if (entry.level === "warn") console.warn(entry);
    else console.log(entry);
  }
}

/**
 * Queues entries on the current request; the request middleware flushes
 * them to D1 once the response is out. Outside a request (the cron)
 * nothing is queued: console only.
 */
export class D1Sink implements LogSink {
  write(entry: LogEntry): void {
    const store = currentRequest();
    if (store && store.pending.length < MAX_PENDING_PER_REQUEST) store.pending.push(entry);
  }
}

/** App-wide logger: console + per-request D1 queue. */
export const log = new Logger("worker", [new ConsoleSink(), new D1Sink()]);
