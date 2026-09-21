/**
 * Structured logging with pluggable sinks. The app-wide singleton
 * writes JSON lines to the console (Workers Logs ingests them) AND to
 * a per-isolate ring buffer that /api/debug/logs exposes to the hidden
 * console. Phase 1 adds a D1 sink for persistence (spec D10); the
 * buffer stays as the zero-latency "what just happened" view.
 */
import { BufferSink, Logger, RingBuffer, type LogEntry, type LogSink } from "@feedme2/shared";

export { BufferSink, Logger };
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

/** Recent lines for the debug console. Capacity is a tuning knob. */
export const logBuffer = new RingBuffer<LogEntry>(200);

/** App-wide logger: console + debug buffer. */
export const log = new Logger("worker", [new ConsoleSink(), new BufferSink(logBuffer)]);
