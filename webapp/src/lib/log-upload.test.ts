import { describe, expect, it, vi } from "vitest";
import type { LogEntry, LogUploadEntry } from "@feedme2/shared";
import { ApiError, NetworkError } from "./api-client.ts";
import { createUploadSink } from "./log-upload.ts";

const e = (level: LogEntry["level"], msg = "m", extra: Partial<LogEntry> = {}): LogEntry => ({ ts: 1, level, source: "web", msg, ...extra });

function make(opts: { signedIn?: () => boolean; failWith?: unknown[] } = {}) {
  const failures = [...(opts.failWith ?? [])];
  const sent: LogUploadEntry[][] = [];
  const send = vi.fn(async (batch: LogUploadEntry[]) => {
    if (failures.length > 0) throw failures.shift();
    sent.push(batch);
  });
  let timer: (() => void) | null = null;
  let cancelled = false;
  const sink = createUploadSink({
    send,
    isSignedIn: opts.signedIn ?? (() => true),
    now: () => 0,
    schedule: (fn) => {
      timer = fn;
      return () => { cancelled = true; timer = null; };
    },
  });
  return { sink, sent, send, tick: () => timer?.(), cancelled: () => cancelled };
}

describe("upload sink", () => {
  it("batches info lines until the timer, in chunks of 50", async () => {
    const { sink, sent, tick } = make();
    for (let i = 0; i < 120; i++) sink.write(e("info", `m${i}`));
    expect(sent).toEqual([]);
    tick();
    await sink.flush();
    expect(sent.map((b) => b.length)).toEqual([50, 50, 20]);
  });

  it("flushes an error immediately, together with what was queued before it", async () => {
    const { sink, sent } = make();
    sink.write(e("info"));
    sink.write(e("error"));
    await sink.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.map((x) => x.level)).toEqual(["info", "error"]);
  });

  it("uploads only the LogUploadEntry fields: source and deviceId never leave the phone", async () => {
    const { sink, sent } = make();
    sink.write(e("error", "boom", { data: { a: 1 }, clientId: "me", deviceId: "dev" }));
    await sink.flush();
    expect(sent[0]).toEqual([{ ts: 1, level: "error", msg: "boom", data: { a: 1 }, clientId: "me" }]);
  });

  it("keeps entries when the network fails and retries on the next tick", async () => {
    const { sink, sent, tick } = make({ failWith: [new TypeError("Failed to fetch")] });
    sink.write(e("info"));
    tick();
    await sink.flush();
    expect(sent).toEqual([]);
    tick();
    await sink.flush();
    expect(sent).toHaveLength(1);
  });

  it("re-queues on NetworkError and on a 5xx", async () => {
    const { sink, sent, tick } = make({ failWith: [new NetworkError(), new ApiError(503, null)] });
    sink.write(e("info"));
    for (let i = 0; i < 3; i++) { tick(); await sink.flush(); }
    expect(sent).toHaveLength(1);
  });

  it("drops a batch the server rejects with a 4xx, and warns once on the console only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sink, sent, send, tick } = make({ failWith: [new ApiError(400, null), new ApiError(400, null)] });
    sink.write(e("info", "bad1"));
    tick();
    await sink.flush();
    sink.write(e("info", "bad2"));
    tick();
    await sink.flush();
    sink.write(e("info", "good"));
    tick();
    await sink.flush();
    expect(send).toHaveBeenCalledTimes(3);
    expect(sent.map((b) => b.map((x) => x.msg))).toEqual([["good"]]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("drops entries while signed out and never sends them later", async () => {
    let signedIn = false;
    const { sink, sent, tick } = make({ signedIn: () => signedIn });
    sink.write(e("error", "while out"));
    signedIn = true;
    tick();
    await sink.flush();
    expect(sent).toEqual([]);
  });

  it("discards queued entries if the user signs out before the flush: they belong to the old house", async () => {
    let signedIn = true;
    const { sink, send, tick } = make({ signedIn: () => signedIn });
    sink.write(e("info"));
    signedIn = false;
    tick();
    await sink.flush();
    signedIn = true;
    await sink.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("caps the queue at 500, dropping the oldest", async () => {
    const { sink, sent, tick } = make();
    for (let i = 0; i < 520; i++) sink.write(e("info", `m${i}`));
    tick();
    await sink.flush();
    const all = sent.flat();
    expect(all).toHaveLength(500);
    expect(all[0]!.msg).toBe("m20");
    expect(all.at(-1)!.msg).toBe("m519");
  });

  it("shrinks what the server would reject: over-long msg and data over 1 KB", async () => {
    const { sink, sent } = make();
    sink.write(e("error", "x".repeat(900), { data: { blob: "y".repeat(2000) } }));
    await sink.flush();
    const out = sent[0]![0]!;
    expect(out.msg).toHaveLength(500);
    expect(out.data).toEqual({ truncated: true });
  });

  it("does not throw on circular data", async () => {
    const { sink, sent } = make();
    const loop: Record<string, unknown> = {};
    loop["self"] = loop;
    sink.write(e("error", "loop", { data: loop }));
    await sink.flush();
    expect(sent[0]![0]!.data).toEqual({ truncated: true });
  });

  it("stop() cancels the schedule", () => {
    const { sink, cancelled } = make();
    sink.stop();
    expect(cancelled()).toBe(true);
  });

  it("passes keepalive through to send when asked", async () => {
    const { sink, send } = make();
    sink.write(e("info"));
    await sink.flush({ keepalive: true });
    expect(send).toHaveBeenCalledWith(expect.any(Array), { keepalive: true });
  });
});
