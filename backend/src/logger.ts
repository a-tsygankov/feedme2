/**
 * Structured logging with pluggable sinks. The app-wide singleton
 * writes JSON lines to the console (Workers Logs ingests them) AND to
 * a per-isolate ring buffer that /api/debug/logs exposes to the hidden
 * console. Phase 1 adds a D1 sink for persistence (spec D10); the
 * buffer stays as the zero-latency "what just happened" view.
 */
import { RingBuffer, type LogEntry, type LogLevel } from "@feedme2/shared";

export interface LogSink {
  write(entry: LogEntry): void;
}

export class ConsoleSink implements LogSink {
  write(entry: LogEntry): void {
    const line = JSON.stringify(entry);
    if (entry.level === "error") console.error(line);
    else if (entry.level === "warn") console.warn(line);
    else console.log(line);
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
    const entry: LogEntry = {
      ts: this.clock(),
      level,
      source: "worker",
      msg,
      ...(data ? { data } : {}),
    };
    for (const sink of this.sinks) sink.write(entry);
  }
}

/** Recent lines for the debug console. Capacity is a tuning knob. */
export const logBuffer = new RingBuffer<LogEntry>(200);

/** App-wide logger: console + debug buffer. */
export const log = new Logger([new ConsoleSink(), new BufferSink(logBuffer)]);
