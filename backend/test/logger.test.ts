import { describe, expect, it } from "vitest";
import { RingBuffer } from "@feedme2/shared";
import type { LogEntry } from "@feedme2/shared";
import { BufferSink, Logger, type LogSink } from "../src/logger.ts";

describe("Logger", () => {
  it("stamps source=worker and the clock, and fans out to every sink", () => {
    const seen: LogEntry[] = [];
    const sink: LogSink = { write: (e) => void seen.push(e) };
    const buffer = new RingBuffer<LogEntry>(10);
    const log = new Logger([sink, new BufferSink(buffer)], () => 1234);

    log.info("hello", { a: 1 });
    log.error("boom");

    expect(seen).toEqual([
      { ts: 1234, level: "info", source: "worker", msg: "hello", data: { a: 1 } },
      { ts: 1234, level: "error", source: "worker", msg: "boom" },
    ]);
    expect(buffer.toArray()).toEqual(seen);
  });
});
