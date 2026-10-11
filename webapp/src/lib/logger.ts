/**
 * Client-side structured logging — same entry shape as the worker's
 * (shared LogEntry) so the hidden console renders both feeds in one
 * list. The singleton writes to the devtools console AND to a ring
 * buffer the console displays; main.tsx attaches the upload sink.
 */
import { BufferSink, Logger, RingBuffer, type LogEntry, type LogSink } from "@feedme2/shared";

export { BufferSink, Logger };
export type { LogSink };

export class ConsoleSink implements LogSink {
  // (msg, data) as separate console arguments, unlike the worker's
  // object-passing sink: this targets the devtools object inspector,
  // not the Workers Logs indexer.
  write(entry: LogEntry): void {
    const args = entry.data ? [entry.msg, entry.data] : [entry.msg];
    if (entry.level === "error") console.error(...args);
    else if (entry.level === "warn") console.warn(...args);
    else console.info(...args);
  }
}

/** `String({})` is "[object Object]"; JSON is what a person can read. */
function describe(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Route uncaught errors + unhandled rejections into the logger so the
 * hidden console shows crashes nobody would otherwise see on a phone.
 * Returns an uninstall function.
 */
export function installGlobalErrorCapture(logger: Logger, target: EventTarget): () => void {
  const onError = (event: Event): void => {
    const e = event as ErrorEvent;
    const message = e.message ?? "Unknown error";
    const data: Record<string, unknown> = {};
    if (e.filename) data["filename"] = e.filename;
    if (typeof e.lineno === "number") data["lineno"] = e.lineno;
    if (typeof e.colno === "number") data["colno"] = e.colno;
    const stack = (e.error as { stack?: unknown } | undefined)?.stack;
    if (typeof stack === "string") data["stack"] = stack.slice(0, 2000);
    logger.error(`Uncaught error: ${message}`, Object.keys(data).length ? data : undefined);
  };
  const onRejection = (event: Event): void => {
    const reason = (event as PromiseRejectionEvent).reason;
    const message = reason instanceof Error ? reason.message : describe(reason);
    const stack = reason instanceof Error && typeof reason.stack === "string" ? reason.stack.slice(0, 2000) : undefined;
    logger.error(`Unhandled rejection: ${message}`, stack ? { stack } : undefined);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

export const clientLogBuffer = new RingBuffer<LogEntry>(200);
/** Mutable on purpose: the Logger holds this array, so a sink attached later (the upload sink needs the auth store
 * and api client, which this module must not import) still receives every subsequent line. */
const sinks: LogSink[] = [new ConsoleSink(), new BufferSink(clientLogBuffer)];
export const appLog = new Logger("web", sinks);

/** Fan `appLog` out to one more sink. Returns the detach function. */
export function attachSink(sink: LogSink): () => void {
  sinks.push(sink);
  return () => {
    const i = sinks.indexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
  };
}
