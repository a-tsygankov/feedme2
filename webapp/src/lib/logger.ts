/**
 * Client-side structured logging — same entry shape as the worker's
 * (shared LogEntry) so the hidden console renders both feeds in one
 * list. The singleton writes to the devtools console AND to a ring
 * buffer the console displays; Phase 1 adds the upload sink.
 */
import { RingBuffer, type LogEntry, type LogLevel } from "@feedme2/shared";

export interface LogSink {
  write(entry: LogEntry): void;
}

export class ConsoleSink implements LogSink {
  write(entry: LogEntry): void {
    const args = entry.data ? [entry.msg, entry.data] : [entry.msg];
    if (entry.level === "error") console.error(...args);
    else if (entry.level === "warn") console.warn(...args);
    else console.info(...args);
  }
}

export class BufferSink implements LogSink {
  constructor(private readonly buffer: RingBuffer<LogEntry>) {}
  write(entry: LogEntry): void {
    this.buffer.push(entry);
  }
}

export class Logger {
  constructor(
    private readonly sinks: LogSink[],
    private readonly clock: () => number = Date.now,
  ) {}

  debug(msg: string, data?: Record<string, unknown>): void {
    this.write("debug", msg, data);
  }
  info(msg: string, data?: Record<string, unknown>): void {
    this.write("info", msg, data);
  }
  warn(msg: string, data?: Record<string, unknown>): void {
    this.write("warn", msg, data);
  }
  error(msg: string, data?: Record<string, unknown>): void {
    this.write("error", msg, data);
  }

  private write(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = { ts: this.clock(), level, source: "web", msg, ...(data ? { data } : {}) };
    for (const sink of this.sinks) sink.write(entry);
  }
}

/**
 * Route uncaught errors + unhandled rejections into the logger so the
 * hidden console shows crashes nobody would otherwise see on a phone.
 * Returns an uninstall function.
 */
export function installGlobalErrorCapture(logger: Logger, target: EventTarget): () => void {
  const onError = (event: Event): void => {
    const message = (event as ErrorEvent).message ?? "Unknown error";
    logger.error(`Uncaught error: ${message}`);
  };
  const onRejection = (event: Event): void => {
    const reason = (event as PromiseRejectionEvent).reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    logger.error(`Unhandled rejection: ${message}`);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

export const clientLogBuffer = new RingBuffer<LogEntry>(200);
export const appLog = new Logger([new ConsoleSink(), new BufferSink(clientLogBuffer)]);
