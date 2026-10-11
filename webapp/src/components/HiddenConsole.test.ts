import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "@feedme2/shared";
import { downloadJson, filterEntries, makeConsoleDataSource, mergeFeeds, startLivePoll } from "./HiddenConsole.tsx";
import { rowKeys } from "./LogList.tsx";

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
  it("keeps lines that share ts and msg but differ in source or level", () => {
    const out = mergeFeeds([e(1, "same", "web", "me")], [e(1, "same", "worker", "me"), e(1, "same", "web", "me", "warn")]);
    expect(out.map((x) => `${x.source}/${x.level}`)).toEqual(["web/info", "worker/info", "web/warn"]);
  });
  it("collapses a local message longer than 500 chars with its uploaded copy, which the server truncated", () => {
    const long = "x".repeat(800);
    const out = mergeFeeds([e(1, long, "web", "me")], [e(1, long.slice(0, 500), "web", "me")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.msg).toHaveLength(800);
  });
});

describe("rowKeys", () => {
  it("is stable when a newer line arrives, and numbers identical lines", () => {
    const a = e(2, "a", "web", "me");
    const b = e(1, "b", "web", "me");
    const before = rowKeys([a, b]);
    const after = rowKeys([e(3, "new"), a, b]);
    expect(after.slice(1)).toEqual(before);
    const dup = rowKeys([a, { ...a }, { ...a }]);
    expect(new Set(dup).size).toBe(3);
  });
});

describe("console data source", () => {
  const make = (signedIn = true, fail = false) => {
    const debugLogs = vi.fn(async (q: { level?: string | undefined }) => {
      if (fail) throw new Error("offline");
      return [e(q.level === "error" ? 3 : q.level === "warn" ? 2 : 1, `m-${q.level ?? "any"}`, "worker", undefined, (q.level as LogEntry["level"]) ?? "info")];
    });
    return { debugLogs, ds: makeConsoleDataSource("me", { debugLogs, isSignedIn: () => signedIn }) };
  };
  it("passes source and device to the server, and omits level for 'all levels'", async () => {
    const { ds, debugLogs } = make();
    await ds.getRemoteLogs({ source: "device", minLevel: "debug", device: " dev-1 " });
    expect(debugLogs).toHaveBeenCalledTimes(1);
    expect(debugLogs).toHaveBeenCalledWith({ limit: 300, source: "device", device: "dev-1" });
  });
  it("asks for nothing extra when no filter is active", async () => {
    const { ds, debugLogs } = make();
    await ds.getRemoteLogs({ source: "all", minLevel: "debug", device: "" });
    expect(debugLogs).toHaveBeenCalledWith({ limit: 300 });
  });
  it("turns a minimum level into one request per level at or above it (the server matches exactly), merged newest first", async () => {
    const { ds, debugLogs } = make();
    const r = await ds.getRemoteLogs({ source: "web", minLevel: "warn", device: "" });
    expect(debugLogs.mock.calls.map((c) => c[0])).toEqual([
      { limit: 300, source: "web", level: "warn" },
      { limit: 300, source: "web", level: "error" },
    ]);
    expect(r.status === "ok" && r.entries.map((x) => x.msg)).toEqual(["m-error", "m-warn"]);
  });
  it("skips the request when signed out and degrades to unreachable on failure", async () => {
    const out = make(false);
    expect(await out.ds.getRemoteLogs({ source: "all", minLevel: "debug", device: "" })).toEqual({ status: "signedOut" });
    expect(out.debugLogs).not.toHaveBeenCalled();
    expect(await make(true, true).ds.getRemoteLogs({ source: "all", minLevel: "debug", device: "" })).toEqual({ status: "unreachable" });
  });
});

describe("downloadJson", () => {
  const files = (calls: unknown[][]) => (calls[0]![0] as { files: File[] }).files;
  it("shares the file through the system sheet on a touch phone that can share files", async () => {
    const share = vi.fn(async () => undefined);
    const anchorDownload = vi.fn();
    await downloadJson("{}", { coarsePointer: true, share, canShare: () => true, anchorDownload }, () => 7);
    expect(share).toHaveBeenCalledTimes(1);
    expect(files(share.mock.calls)[0]!.name).toBe("feedme2-logs-7.json");
    expect(anchorDownload).not.toHaveBeenCalled();
  });
  it("downloads normally on desktop even when share exists", async () => {
    const share = vi.fn(async () => undefined);
    const anchorDownload = vi.fn();
    await downloadJson("{}", { coarsePointer: false, share, canShare: () => true, anchorDownload });
    expect(share).not.toHaveBeenCalled();
    expect(anchorDownload).toHaveBeenCalledTimes(1);
  });
  it("falls back to the download when the browser cannot share files or sharing fails, but not when the person cancels", async () => {
    const a1 = vi.fn();
    await downloadJson("{}", { coarsePointer: true, share: async () => undefined, canShare: () => false, anchorDownload: a1 });
    expect(a1).toHaveBeenCalledTimes(1);
    const a2 = vi.fn();
    await downloadJson("{}", { coarsePointer: true, share: async () => { throw new Error("nope"); }, canShare: () => true, anchorDownload: a2 });
    expect(a2).toHaveBeenCalledTimes(1);
    const a3 = vi.fn();
    await downloadJson("{}", { coarsePointer: true, share: async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); }, canShare: () => true, anchorDownload: a3 });
    expect(a3).not.toHaveBeenCalled();
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
    const devs = [{ ...e(1, "d1", "device"), deviceId: "a" }, { ...e(2, "d2", "device"), deviceId: "b" }];
    expect(filterEntries(devs, { source: "device", minLevel: "debug", text: "", device: "b" }).map((x) => x.msg)).toEqual(["d2"]);
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
