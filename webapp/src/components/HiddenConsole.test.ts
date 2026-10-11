import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "@feedme2/shared";
import { filterEntries, mergeFeeds, startLivePoll } from "./HiddenConsole.tsx";

const e = (ts: number, msg: string, source: LogEntry["source"] = "web", clientId?: string, level: LogEntry["level"] = "info"): LogEntry => ({
  ts, level, source, msg, ...(clientId ? { clientId } : {}),
});

describe("mergeFeeds", () => {
  it("de-duplicates this phone's uploads (same ts, msg, clientId) and sorts newest first", () => {
    const local = [e(3, "c", "web", "me"), e(1, "a", "web", "me")];
    const remote = [e(3, "c", "web", "other"), e(2, "b", "worker"), e(1, "a", "web", "me")];
    const out = mergeFeeds(local, remote);
    expect(out.map((x) => `${x.ts}${x.msg}${x.clientId ?? ""}`)).toEqual(["3cme", "3cother", "2b", "1ame"]);
  });
  it("keeps the local copy when a duplicate exists", () => {
    const local = [{ ...e(1, "a", "web", "me"), data: { local: true } }];
    const out = mergeFeeds(local, [e(1, "a", "web", "me")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.data).toEqual({ local: true });
  });
  it("is stable for equal timestamps: input order, local before remote", () => {
    const out = mergeFeeds([e(5, "l1", "web", "me"), e(5, "l2", "web", "me")], [e(5, "r1", "worker"), e(5, "r2", "worker")]);
    expect(out.map((x) => x.msg)).toEqual(["l1", "l2", "r1", "r2"]);
  });
  it("does not collapse distinct lines that share a timestamp", () => {
    expect(mergeFeeds([e(1, "a", "web", "me"), e(1, "b", "web", "me")], [])).toHaveLength(2);
  });
  it("does not mutate its inputs", () => {
    const local = [e(1, "a"), e(2, "b")];
    const remote = [e(3, "c", "worker")];
    mergeFeeds(local, remote);
    expect(local.map((x) => x.ts)).toEqual([1, 2]);
    expect(remote.map((x) => x.ts)).toEqual([3]);
  });
  it("handles empty feeds", () => {
    expect(mergeFeeds([], [])).toEqual([]);
  });
});

describe("filterEntries", () => {
  const all = [e(1, "alpha", "web", undefined, "debug"), e(2, "beta", "worker", undefined, "warn"), e(3, "gamma", "device", undefined, "error")];
  it("filters by source, min level, and text (also over data)", () => {
    expect(filterEntries(all, { source: "worker", minLevel: "debug", text: "" }).map((x) => x.msg)).toEqual(["beta"]);
    expect(filterEntries(all, { source: "all", minLevel: "warn", text: "" }).map((x) => x.msg)).toEqual(["beta", "gamma"]);
    expect(filterEntries(all, { source: "all", minLevel: "debug", text: " ALPH " }).map((x) => x.msg)).toEqual(["alpha"]);
    const withData = [{ ...e(1, "m"), data: { stack: "TypeError at foo" } }];
    expect(filterEntries(withData, { source: "all", minLevel: "debug", text: "typeerror" })).toHaveLength(1);
  });
});

describe("startLivePoll", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ticks every 5 s and stops when cancelled", () => {
    const tick = vi.fn();
    const stop = startLivePoll(tick, () => false);
    vi.advanceTimersByTime(4999);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(20_000);
    expect(tick).toHaveBeenCalledTimes(3);
  });
  it("skips ticks while the tab is hidden and resumes after", () => {
    const tick = vi.fn();
    let hidden = true;
    const stop = startLivePoll(tick, () => hidden);
    vi.advanceTimersByTime(15_000);
    expect(tick).not.toHaveBeenCalled();
    hidden = false;
    vi.advanceTimersByTime(5000);
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
  });
});
