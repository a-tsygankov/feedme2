import { describe, expect, it } from "vitest";
import { BufferSink, Logger, type LogSink } from "./logger.ts";
import { RingBuffer } from "./ring-buffer.ts";
import type { LogEntry } from "./log.ts";

describe("shared Logger", () => {
  it("stamps the configured source and clock and fans out to every sink", () => {
    const seen: LogEntry[] = [];
    const sink: LogSink = { write: (e) => void seen.push(e) };
    const buf = new RingBuffer<LogEntry>(4);
    const log = new Logger("device", [sink, new BufferSink(buf)], () => 42);
    log.debug("d");
    log.info("i", { a: 1 });
    expect(seen).toEqual([
      { ts: 42, level: "debug", source: "device", msg: "d" },
      { ts: 42, level: "info", source: "device", msg: "i", data: { a: 1 } },
    ]);
    expect(buf.toArray()).toEqual(seen);
    expect(Object.hasOwn(seen[0]!, "data")).toBe(false);
  });
});
