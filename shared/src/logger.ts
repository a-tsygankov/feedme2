/**
 * The logger core every tier shares: stamps `ts`, `level` and the
 * tier's `source`, then fans one LogEntry out to each sink. Sinks are
 * per tier (the worker writes objects for Workers Logs, the browser
 * writes to devtools, the device later posts batches) — the core is
 * not, so a fix here reaches all of them.
 */
import type { LogEntry, LogLevel, LogSource } from "./log.ts";
import type { RingBuffer } from "./ring-buffer.ts";

export interface LogSink {
  write(entry: LogEntry): void;
}

/** Keeps the most recent entries for the hidden console. */
export class BufferSink implements LogSink {
  constructor(private readonly buffer: RingBuffer<LogEntry>) {}
  write(entry: LogEntry): void {
    this.buffer.push(entry);
  }
}

export class Logger {
  constructor(
    private readonly source: LogSource,
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
    const entry: LogEntry = {
      ts: this.clock(),
      level,
      source: this.source,
      msg,
      ...(data ? { data } : {}),
    };
    for (const sink of this.sinks) sink.write(entry);
  }
}
