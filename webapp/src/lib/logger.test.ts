import { describe, expect, it, vi } from "vitest";
import { RingBuffer, type LogEntry } from "@feedme2/shared";
import { BufferSink, Logger, installGlobalErrorCapture, type LogSink } from "./logger.ts";

describe("client Logger", () => {
  it("stamps source=web and fans out", () => {
    const seen: LogEntry[] = [];
    const sink: LogSink = { write: (e) => void seen.push(e) };
    const buf = new RingBuffer<LogEntry>(5);
    const log = new Logger([sink, new BufferSink(buf)], () => 7);
    log.warn("slow", { ms: 900 });
    expect(seen).toEqual([{ ts: 7, level: "warn", source: "web", msg: "slow", data: { ms: 900 } }]);
    expect(buf.toArray()).toEqual(seen);
  });

  it("captures uncaught errors and unhandled rejections until uninstalled", () => {
    const seen: LogEntry[] = [];
    const log = new Logger([{ write: (e) => void seen.push(e) }], () => 0);
    const target = new EventTarget();
    const uninstall = installGlobalErrorCapture(log, target);

    target.dispatchEvent(Object.assign(new Event("error"), { message: "kaboom" }));
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("nope") }));
    expect(seen.map((e) => e.msg)).toEqual(["Uncaught error: kaboom", "Unhandled rejection: nope"]);

    uninstall();
    target.dispatchEvent(Object.assign(new Event("error"), { message: "after" }));
    expect(seen).toHaveLength(2);
    vi.restoreAllMocks();
  });
});
