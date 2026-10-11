import { describe, expect, it, vi } from "vitest";
import type { LogEntry, LogUploadEntry } from "@feedme2/shared";
import { ApiError, NetworkError } from "./api-client.ts";
import { createUploadSink, KEEPALIVE_MAX_BYTES } from "./log-upload.ts";

const e = (level: LogEntry["level"], msg = "m", extra: Partial<LogEntry> = {}): LogEntry => ({ ts: 1, level, source: "web", msg, ...extra });

function make(opts: { signedIn?: () => boolean; failWith?: unknown[]; gate?: () => Promise<void> } = {}) {
  const failures = [...(opts.failWith ?? [])];
  const sent: LogUploadEntry[][] = [];
  const clock = { t: 0 };
  const send = vi.fn(async (batch: LogUploadEntry[], _opts?: { keepalive?: boolean }) => {
    if (opts.gate) await opts.gate();
    if (failures.length > 0) throw failures.shift();
    sent.push(batch);
  });
  let timer: (() => void) | null = null;
  let cancelled = false;
  const sink = createUploadSink({
    send,
    isSignedIn: opts.signedIn ?? (() => true),
    now: () => clock.t,
    schedule: (fn) => {
      timer = fn;
      return () => { cancelled = true; timer = null; };
    },
  });
  return { sink, sent, send, clock, tick: () => timer?.(), cancelled: () => cancelled };
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

  it("clear() drops what was queued for the session that ended: it belongs to the old house", async () => {
    const { sink, send, tick } = make();
    sink.write(e("info"));
    sink.clear();
    tick();
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

  it("shrinks what the server would reject: over-long msg, and data over 1 KB with no string field to trim", async () => {
    const { sink, sent } = make();
    sink.write(e("error", "x".repeat(900), { data: { nums: Array.from({ length: 400 }, (_, i) => i * 1000) } }));
    await sink.flush();
    const out = sent[0]![0]!;
    expect(out.msg).toHaveLength(500);
    expect(out.data).toEqual({ truncated: true });
  });

  it("keeps a crash stack: a 2000-char stack is trimmed to fit, not replaced by {truncated:true}", async () => {
    const { sink, sent } = make();
    const stack = Array.from({ length: 200 }, (_, i) => `at fn${i} (a.js:1:1)`).join("\n").slice(0, 2000);
    sink.write(e("error", "Uncaught error: boom", { data: { filename: "a.js", lineno: 3, colno: 4, stack } }));
    await sink.flush();
    const data = sent[0]![0]!.data as Record<string, unknown>;
    expect(data["filename"]).toBe("a.js");
    expect(data["lineno"]).toBe(3);
    const kept = data["stack"] as string;
    expect(kept.length).toBeGreaterThanOrEqual(800);
    expect(kept.length).toBeLessThan(stack.length);
    expect(stack.startsWith(kept)).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThanOrEqual(1024);
  });

  it("trims the longest string field first and measures bytes, not characters", async () => {
    const { sink, sent } = make();
    sink.write(e("error", "m", { data: { note: "keep me", stack: "é".repeat(1500), other: "z".repeat(100) } }));
    await sink.flush();
    const data = sent[0]![0]!.data as Record<string, string>;
    expect(data["note"]).toBe("keep me");
    expect(data["other"]).toBe("z".repeat(100));
    expect(data["stack"]!.length).toBeGreaterThan(300);
    expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThanOrEqual(1024);
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

const tick0 = () => new Promise<void>((r) => setTimeout(r, 0));

describe("upload sink: sessions and early lines", () => {
  it("holds lines logged while signed out and queues them on adoptSignedOutLines()", async () => {
    let signedIn = false;
    const { sink, sent } = make({ signedIn: () => signedIn });
    sink.write(e("info", "login failed", { ts: 5 }));
    sink.write(e("warn", "second", { ts: 6 }));
    await sink.flush();
    expect(sent).toEqual([]);
    signedIn = true;
    sink.adoptSignedOutLines();
    await sink.flush();
    expect(sent.flat().map((x) => x.msg)).toEqual(["login failed", "second"]);
  });

  it("keeps only the last 50 signed-out lines", async () => {
    let signedIn = false;
    const { sink, sent } = make({ signedIn: () => signedIn });
    for (let i = 0; i < 80; i++) sink.write(e("info", `m${i}`, { ts: i }));
    signedIn = true;
    sink.adoptSignedOutLines();
    await sink.flush();
    const msgs = sent.flat().map((x) => x.msg);
    expect(msgs).toHaveLength(50);
    expect(msgs[0]).toBe("m30");
  });

  it("an error among the adopted lines goes out at once", async () => {
    let signedIn = false;
    const { sink, send } = make({ signedIn: () => signedIn });
    sink.write(e("error", "boot crash"));
    signedIn = true;
    sink.adoptSignedOutLines();
    expect(send).toHaveBeenCalledTimes(1);
    await sink.flush();
  });

  it("clear() also forgets the side buffer: lines from before the sign-out do not ride into the next session", async () => {
    let signedIn = false;
    const { sink, send } = make({ signedIn: () => signedIn });
    sink.write(e("info", "while out"));
    sink.clear();
    signedIn = true;
    sink.adoptSignedOutLines();
    await sink.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("seeds from the ring buffer on attach, in order, and seeding again is idempotent (ts|msg)", async () => {
    const { sink, sent } = make();
    const ring = [e("info", "early1", { ts: 1 }), e("warn", "early2", { ts: 2 })];
    sink.seed(ring);
    sink.seed(ring);
    sink.write(e("info", "later", { ts: 3 }));
    sink.seed([...ring, e("info", "later", { ts: 3 })]);
    await sink.flush();
    expect(sent.flat().map((x) => x.msg)).toEqual(["early1", "early2", "later"]);
  });

  it("seeding while signed out goes to the side buffer", async () => {
    let signedIn = false;
    const { sink, sent } = make({ signedIn: () => signedIn });
    sink.seed([e("info", "boot", { ts: 1 })]);
    await sink.flush();
    expect(sent).toEqual([]);
    signedIn = true;
    sink.adoptSignedOutLines();
    await sink.flush();
    expect(sent.flat().map((x) => x.msg)).toEqual(["boot"]);
  });

  it("a mid-loop sign-out (with clear) stops sending further batches", async () => {
    let signedIn = true;
    const { sink, send } = make({ signedIn: () => signedIn });
    for (let i = 0; i < 120; i++) sink.write(e("info", `m${i}`));
    send.mockImplementationOnce(async () => { signedIn = false; sink.clear(); });
    await sink.flush();
    expect(send).toHaveBeenCalledTimes(1);
    signedIn = true;
    await sink.flush();
    expect(send).toHaveBeenCalledTimes(1); // the queue was cleared with the session
  });

  it("a sign-out without clear() still stops after the batch in flight", async () => {
    let signedIn = true;
    const { sink, send } = make({ signedIn: () => signedIn });
    for (let i = 0; i < 120; i++) sink.write(e("info", `m${i}`));
    send.mockImplementationOnce(async () => { signedIn = false; });
    await sink.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("upload sink: failures and concurrency", () => {
  it.each([408, 429])("a %i is retried, not dropped", async (status) => {
    const { sink, sent, tick } = make({ failWith: [new ApiError(status, null)] });
    sink.write(e("info", "keep"));
    tick();
    await sink.flush();
    expect(sent).toEqual([]);
    tick();
    await sink.flush();
    expect(sent.flat().map((x) => x.msg)).toEqual(["keep"]);
  });

  it("a line written while a send is in flight is not lost when the send succeeds (dropped by identity)", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let first = true;
    const { sink, sent } = make({ gate: () => { if (!first) return Promise.resolve(); first = false; return held; } });
    sink.write(e("info", "a", { ts: 1 }));
    const p = sink.flush();
    sink.write(e("info", "b", { ts: 2 }));
    release();
    await p;
    expect(sent.flat().map((x) => x.msg)).toEqual(["a", "b"]);
  });

  it("the 500 cap while a send is in flight trims the head only: the newest lines survive", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let first = true;
    const { sink, sent } = make({ gate: () => { if (!first) return Promise.resolve(); first = false; return held; } });
    for (let i = 0; i < 10; i++) sink.write(e("info", `a${i}`, { ts: i }));
    const p = sink.flush();
    for (let i = 0; i < 520; i++) sink.write(e("info", `b${i}`, { ts: 100 + i }));
    release();
    await p;
    const bs = sent.flat().map((x) => x.msg).filter((m) => m.startsWith("b"));
    expect(bs).toHaveLength(500);
    expect(bs[0]).toBe("b20");
    expect(bs.at(-1)).toBe("b519");
  });

  it("an error-triggered flush backs off after a failed send: 5 s, doubling, timer flushes unaffected", async () => {
    const { sink, send, clock, tick } = make({ failWith: Array.from({ length: 8 }, () => new NetworkError()) });
    const errorAt = async (t: number) => {
      clock.t = t;
      sink.write(e("error", `at${t}`, { ts: t }));
      await tick0();
    };
    await errorAt(0);
    expect(send).toHaveBeenCalledTimes(1);
    await errorAt(4_999);
    expect(send).toHaveBeenCalledTimes(1); // inside the 5 s backoff: waits for the timer
    await errorAt(5_000);
    expect(send).toHaveBeenCalledTimes(2); // that failed too: the next window is 10 s
    await errorAt(14_999);
    expect(send).toHaveBeenCalledTimes(2);
    await errorAt(15_000);
    expect(send).toHaveBeenCalledTimes(3);
    tick(); // the 30 s timer is not gated by the error backoff
    await tick0();
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("backoff is capped at 60 s and a success resets it", async () => {
    const { sink, send, clock } = make({ failWith: Array.from({ length: 6 }, () => new NetworkError()) });
    let t = 0;
    const burst = async () => {
      clock.t = t;
      sink.write(e("error", `e${t}`, { ts: t }));
      await tick0();
    };
    // Six failures: windows of 5, 10, 20, 40, 60 and 60 s.
    for (const wait of [0, 5_000, 10_000, 20_000, 40_000, 60_000]) { t += wait; await burst(); }
    expect(send).toHaveBeenCalledTimes(6);
    t += 59_999;
    await burst();
    expect(send).toHaveBeenCalledTimes(6); // still inside the capped 60 s
    t += 1;
    await burst(); // succeeds: backoff resets
    expect(send).toHaveBeenCalledTimes(7);
    await burst();
    expect(send).toHaveBeenCalledTimes(8); // immediately allowed again
  });
});

describe("upload sink: page-hide flush", () => {
  it("sends ONE chunk of at most 60 KB, errors first, then the newest lines", async () => {
    const { sink, sent, send } = make({ failWith: [new NetworkError()] });
    const pad = { data: { stack: "s".repeat(900) } };
    for (let i = 0; i < 45; i++) sink.write(e("info", `i${i} ${"m".repeat(450)}`, { ts: i, ...pad }));
    // The first error's immediate flush fails and starts the backoff, so the queue keeps everything.
    for (let k = 0; k < 5; k++) sink.write(e("error", `err${k} ${"m".repeat(450)}`, { ts: 1000 + k, ...pad }));
    await tick0();
    sent.length = 0;
    send.mockClear();
    await sink.flush({ keepalive: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.any(Array), { keepalive: true });
    const chunk = sent[0]!;
    expect(new TextEncoder().encode(JSON.stringify(chunk)).length).toBeLessThanOrEqual(KEEPALIVE_MAX_BYTES);
    expect(chunk.length).toBeLessThan(50);
    const heads = chunk.map((x) => x.msg.split(" ")[0]);
    for (let k = 0; k < 5; k++) expect(heads).toContain(`err${k}`);
    expect(heads).toContain("i44"); // the newest info line made it
    expect(heads).not.toContain("i0"); // the oldest did not
    expect(chunk.map((x) => x.ts)).toEqual([...chunk.map((x) => x.ts)].sort((a, b) => a - b)); // chronological
  });

  it("a keepalive flush requested while a normal flush is in flight still runs after it", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let first = true;
    const { sink, send } = make({ failWith: [new NetworkError()], gate: () => { if (!first) return Promise.resolve(); first = false; return held; } });
    sink.write(e("info", "a"));
    const normal = sink.flush();
    const hide = sink.flush({ keepalive: true });
    release();
    await Promise.all([normal, hide]);
    // The normal send failed and kept the line; the page-hide flush then sent it with keepalive.
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(expect.any(Array), { keepalive: true });
  });

  it("a flush never stops the schedule: only stop() does (pages restored from bfcache keep uploading)", async () => {
    const { sink, cancelled } = make();
    sink.write(e("info"));
    await sink.flush({ keepalive: true });
    expect(cancelled()).toBe(false);
  });
});
