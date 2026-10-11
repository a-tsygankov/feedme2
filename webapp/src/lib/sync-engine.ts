/**
 * Feedings are the one thing a person must be able to log with no
 * network (spec §4.2). Writes go into the Dexie outbox first; this
 * engine drains it in order whenever the app is online and visible.
 *
 * What a failed send means (decided per cause, never per "is it a 4xx"):
 *  - no connection (NetworkError / TypeError / abort or timeout): stop, keep the op, status "offline";
 *  - 401, 408, 425, 429, any 5xx, or something unexpected: stop, keep the op, status "error". The op's attempt
 *    counter goes up (not for 401, that is the session's problem), and after MAX_ATTEMPTS it is parked (`dead`) so
 *    one poisoned op cannot block the queue forever;
 *  - 400, 403, 404, 409, 410, 413, 422: the server will never accept it, so drop it and report why. The one
 *    exception is a DELETE answered 404: the feeding is already gone, so it counts as sent (see sendGroup);
 *  - a ZodError while parsing a 2xx body: the server did take it, so it counts as sent.
 * Dropping on "any 4xx" once silently threw away feedings on 408/429, which are retryable.
 */
import type { EntityTable } from "dexie";
import type { FeedingCreate, FeedingPatch } from "@feedme2/shared";
import { api, ApiError, NetworkError } from "./api-client.ts";
import { authStore } from "./auth-store.ts";
import { feedmeDb, type OutboxOp, type OutboxRow } from "./db.ts";
import { appLog } from "./logger.ts";

export interface DrainResult { sent: number; dropped: number; stopped: boolean }
export type SyncStatus = "idle" | "syncing" | "offline" | "error";
export interface SyncSnapshot { pending: number; status: SyncStatus }
export interface DroppedOp { kind: OutboxRow["kind"]; feedingId: string; status: number | null; reason: string }
/** What one whole drain run (every pass, until nothing new arrived) did. */
export interface DrainReport { sent: number; dropped: DroppedOp[] }

export const MAX_ATTEMPTS = 10;
export const MAX_BATCH = 100;
export const SEND_TIMEOUT_MS = 15_000;
export const RETRY_FIRST_MS = 15_000;
export const RETRY_MAX_MS = 5 * 60_000;
export const LOCK_NAME = "feedme2-sync";

type CallInit = { signal?: AbortSignal };
interface Deps {
  outbox: EntityTable<OutboxRow, "seq">;
  api: {
    createFeedings(items: FeedingCreate[], init?: CallInit): Promise<unknown>;
    patchFeeding(id: string, patch: FeedingPatch, init?: CallInit): Promise<unknown>;
    deleteFeeding(id: string, init?: CallInit): Promise<unknown>;
  };
  now: () => number;
  log: { info(m: string, d?: Record<string, unknown>): void; warn(m: string, d?: Record<string, unknown>): void; error(m: string, d?: Record<string, unknown>): void };
  /** The signed-in house, or null. Rows are stamped with it and only its rows are sent. */
  houseId: () => string | null;
  /** Web Locks, so two tabs never drain the same outbox at once. Default: navigator.locks when it exists. */
  locks?: Pick<LockManager, "request"> | null;
  isVisible?: () => boolean;
  /** Returns a canceller. Default: setTimeout. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Default: AbortSignal.timeout(15 s) where the browser has it. */
  timeoutSignal?: () => AbortSignal | undefined;
}

type Cls =
  | { kind: "sent" }
  | { kind: "offline" }
  | { kind: "auth" }
  | { kind: "retry"; status: number | null; message: string }
  | { kind: "drop"; status: number; body: unknown };
type Stop = "offline" | "error";

const DROP_STATUSES = new Set([400, 403, 404, 409, 410, 413, 422]);

export function classify(err: unknown): Cls {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "ZodError") return { kind: "sent" };
  if (err instanceof NetworkError || err instanceof TypeError || name === "AbortError" || name === "TimeoutError") return { kind: "offline" };
  if (err instanceof ApiError) {
    if (err.status === 401) return { kind: "auth" };
    if (DROP_STATUSES.has(err.status)) return { kind: "drop", status: err.status, body: err.body };
    // 408/425/429, every 5xx, and any status nobody planned for: keep the op and try again.
    return { kind: "retry", status: err.status, message: `HTTP ${err.status}` };
  }
  return { kind: "retry", status: null, message: err instanceof Error ? err.message : String(err) };
}

const reasonOf = (status: number, body: unknown): string => {
  const e = (body as { error?: unknown } | null)?.error;
  return typeof e === "string" && e ? e : `HTTP ${status}`;
};

/** A patch onto a not-yet-sent create: the create just becomes the edited feeding. */
function applyToCreate(create: FeedingCreate, patch: FeedingPatch): FeedingCreate {
  const merged: FeedingCreate = { ...create };
  const { note, ...rest } = patch;
  Object.assign(merged, rest);
  if (note !== undefined) {
    if (note === null) delete merged.note;
    else merged.note = note;
  }
  return merged;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createSyncEngine(deps: Deps) {
  const locks = deps.locks !== undefined ? deps.locks : (typeof navigator !== "undefined" ? navigator.locks ?? null : null);
  const isVisible = deps.isVisible ?? (() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const schedule = deps.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
  const timeoutSignal = deps.timeoutSignal ?? (() => (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(SEND_TIMEOUT_MS) : undefined));
  const callInit = (): CallInit => { const signal = timeoutSignal(); return signal ? { signal } : {}; };

  let snapshot: SyncSnapshot = { pending: 0, status: "idle" };
  const listeners = new Set<() => void>();
  const drainedListeners = new Set<(r: DrainReport) => void>();
  // No-op sets are skipped: useSyncExternalStore re-renders on every new snapshot object.
  const set = (s: Partial<SyncSnapshot>) => {
    const next = { ...snapshot, ...s };
    if (next.pending === snapshot.pending && next.status === snapshot.status) return;
    snapshot = next;
    for (const l of listeners) l();
  };

  /** Rows this session may send: its own house's, plus legacy "" rows (adopted at the start of a pass). */
  const sendable = (r: OutboxRow, house: string) => !r.dead && (r.houseId === house || r.houseId === "");
  async function refreshPending(): Promise<void> {
    try {
      const house = deps.houseId();
      set({ pending: house === null ? 0 : await deps.outbox.filter((r) => sendable(r, house)).count() });
    } catch (err) {
      deps.log.warn("sync pending count failed", { message: messageOf(err) });
    }
  }
  void refreshPending();

  /** Seqs whose request is in flight in this tab. Coalescing must not rewrite those: the response would delete the row and take the merged edit with it. */
  const sending = new Set<number>();
  let lastHouse = deps.houseId();

  // ---- sending -----------------------------------------------------------------------------------------------

  type Verdict = { sent: true } | { sent: false; status: number | null; reason: string };

  async function sendGroup(group: OutboxRow[]): Promise<Verdict[]> {
    const first = group[0]!;
    switch (first.kind) {
      case "create": {
        const res = await deps.api.createFeedings(group.map((r) => r.payload as FeedingCreate), callInit());
        const accepted = (res as { accepted?: unknown } | null)?.accepted;
        // A body without {accepted} was still a 2xx and the client already validated its shape: nothing to second-guess.
        if (!Array.isArray(accepted)) return group.map(() => ({ sent: true }));
        const existing = new Set(((res as { feedings?: Array<{ id: string }> }).feedings ?? []).map((f) => f.id));
        // Neither accepted nor returned: the server knows the id but will not take it again (a feeding that was
        // deleted, perhaps from another phone, while this create sat in the outbox). Nothing the person can act on, and
        // we cannot tell it from any other refusal, so it counts as sent rather than as a failure banner.
        return group.map((r): Verdict => {
          if (!accepted.includes(r.feedingId) && !existing.has(r.feedingId)) deps.log.info("sync create already removed on server", { feedingId: r.feedingId });
          return { sent: true };
        });
      }
      case "patch":
        await deps.api.patchFeeding(first.feedingId, first.payload as FeedingPatch, callInit());
        return [{ sent: true }];
      case "delete":
        try {
          await deps.api.deleteFeeding(first.feedingId, callInit());
        } catch (err) {
          // 404 on a DELETE means unknown or foreign to this house: either way there is nothing of ours left to remove,
          // which is the outcome the person asked for. (Already-deleted own feedings answer 204.) Dropping it would
          // raise a "change refused" banner for a delete that in effect succeeded.
          if (!(err instanceof ApiError && err.status === 404)) throw err;
        }
        return [{ sent: true }];
    }
  }

  interface Agg { sent: number; dropped: DroppedOp[]; stop: Stop | null }

  async function finish(row: OutboxRow, agg: Agg, drop?: { status: number | null; reason: string; body?: unknown }): Promise<void> {
    await deps.outbox.delete(row.seq!);
    if (!drop) { agg.sent++; return; }
    deps.log.error("sync op dropped", { kind: row.kind, feedingId: row.feedingId, status: drop.status, reason: drop.reason, body: drop.body });
    agg.dropped.push({ kind: row.kind, feedingId: row.feedingId, status: drop.status, reason: drop.reason });
  }

  /** Returns a Stop when the drain must end here. */
  async function processGroup(group: OutboxRow[], agg: Agg): Promise<Stop | null> {
    let cls: Cls;
    try {
      const verdicts = await sendGroup(group);
      for (let i = 0; i < group.length; i++) {
        const v = verdicts[i]!;
        await finish(group[i]!, agg, v.sent ? undefined : { status: v.status, reason: v.reason });
      }
      return null;
    } catch (err) {
      cls = classify(err);
    }
    switch (cls.kind) {
      case "sent":
        for (const r of group) await finish(r, agg);
        return null;
      case "offline": return "offline";
      case "auth": return "error";
      case "drop":
      case "retry": {
        // One poison item must not take its neighbours with it: when a batch is refused (or the server choked on it),
        // find out which item it is by sending them singly.
        if (group.length > 1 && (cls.kind === "drop" || (cls.status !== null && cls.status >= 500))) {
          for (const r of group) {
            const stop = await processGroup([r], agg);
            if (stop) return stop;
          }
          return null;
        }
        if (cls.kind === "drop") {
          for (const r of group) await finish(r, agg, { status: cls.status, reason: reasonOf(cls.status, cls.body), body: cls.body });
          return null;
        }
        deps.log.warn("sync op failed, will retry", { feedingId: group[0]!.feedingId, status: cls.status, message: cls.message });
        let allParked = true;
        for (const r of group) {
          const attempts = r.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            await deps.outbox.update(r.seq!, { attempts, dead: 1 });
            deps.log.error("sync op parked after too many attempts", { kind: r.kind, feedingId: r.feedingId, status: cls.status });
            agg.dropped.push({ kind: r.kind, feedingId: r.feedingId, status: cls.status, reason: "too many attempts" });
          } else {
            allParked = false;
            await deps.outbox.update(r.seq!, { attempts });
          }
        }
        return allParked ? null : "error";
      }
    }
  }

  /** One sweep over the outbox. Returns a Stop when it ended early. */
  async function pass(agg: Agg): Promise<Stop | null> {
    const house = deps.houseId();
    if (house === null) { await refreshPending(); return null; }
    // Legacy rows (queued before rows carried a house) go with whoever drains first rather than being stranded.
    await deps.outbox.where("houseId").equals("").modify({ houseId: house });
    const rows = (await deps.outbox.orderBy("seq").toArray()).filter((r) => !r.dead && r.houseId === house);
    if (rows.length === 0) { await refreshPending(); return null; }
    set({ status: "syncing" });
    let stop: Stop | null = null;
    let i = 0;
    while (i < rows.length && !stop) {
      // Signed out (or into another house) mid-drain: the rest belong to a house this session can no longer speak for.
      if (deps.houseId() !== house) break;
      let j = i + 1;
      if (rows[i]!.kind === "create") while (j < rows.length && j - i < MAX_BATCH && rows[j]!.kind === "create") j++;
      const candidates = rows.slice(i, j);
      // Claim first, then re-read: from here enqueueRow will not coalesce into these rows, and anything it merged or
      // deleted before now is visible to the read. `rows` is a snapshot from before earlier groups were sent, and the
      // person may have edited or deleted a queued row since (an edit would be lost, a deleted create resurrected).
      for (const r of candidates) sending.add(r.seq!);
      try {
        const fresh = await deps.outbox.bulkGet(candidates.map((r) => r.seq!));
        const group = fresh.filter((r): r is OutboxRow => r !== undefined && !r.dead && r.houseId === house);
        if (group.length > 0) stop = await processGroup(group, agg);
      } finally {
        for (const r of candidates) sending.delete(r.seq!);
      }
      i = j;
    }
    await refreshPending();
    return stop;
  }

  // ---- run loop ----------------------------------------------------------------------------------------------

  let running = false;
  let dirty = false;
  let draining: Promise<DrainResult> | null = null;
  let cancelRetry: (() => void) | null = null;
  let backoff = RETRY_FIRST_MS;

  function clearRetry() { cancelRetry?.(); cancelRetry = null; }
  /** While something is still queued and the page is in view, try again on a doubling delay (15 s .. 5 min). */
  function armRetry() {
    clearRetry();
    if (snapshot.pending === 0 || !isVisible()) return;
    const ms = backoff;
    backoff = Math.min(backoff * 2, RETRY_MAX_MS);
    cancelRetry = schedule(() => { cancelRetry = null; if (isVisible()) void drain(); }, ms);
  }

  async function lockedPass(agg: Agg): Promise<"ran" | "skipped"> {
    const body = async () => { agg.stop = await pass(agg); };
    if (!locks) { await body(); return "ran"; }
    // Held by another tab: it is draining the same outbox, so this tab has nothing to do. The lock is taken per pass,
    // not per run, so it is already released when the dirty check below decides to go round again.
    const got = await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) return false;
      await body();
      return true;
    });
    return got ? "ran" : "skipped";
  }

  async function runDrain(): Promise<DrainResult> {
    const agg: Agg = { sent: 0, dropped: [], stop: null };
    let skipped = false;
    try {
      do {
        dirty = false;
        let outcome: "ran" | "skipped";
        try {
          outcome = await lockedPass(agg);
        } catch (err) {
          // Nothing in a pass is supposed to throw (sends are classified); if something does, it is a stop, not a wedge.
          deps.log.error("sync pass crashed", { message: messageOf(err) });
          agg.stop = "error";
          await refreshPending();
          outcome = "ran";
        }
        if (outcome === "skipped") { skipped = true; await refreshPending(); break; }
        if (agg.stop) break;
      } while (dirty);
    } finally {
      // Everything from the last `dirty` check to here is synchronous: a drain() that arrives is either seen by that
      // check or finds `running` false and starts a fresh run. (An enqueue that landed during the run once went unsent.)
      running = false;
      draining = null;
    }
    if (!skipped) set({ status: agg.stop ?? "idle" });
    if (skipped || agg.stop) armRetry();
    else { clearRetry(); backoff = RETRY_FIRST_MS; }
    if (!skipped) {
      const report: DrainReport = { sent: agg.sent, dropped: agg.dropped };
      for (const l of drainedListeners) {
        try { l(report); } catch (err) { deps.log.warn("onDrained listener threw", { message: messageOf(err) }); }
      }
    }
    return { sent: agg.sent, dropped: agg.dropped.length, stopped: agg.stop !== null };
  }

  function drain(): Promise<DrainResult> {
    // A drain asked for while one runs is not a second request: the running one goes round once more to cover it.
    dirty = true;
    if (running) return draining!;
    running = true;
    draining = runDrain();
    return draining;
  }

  // ---- queueing ----------------------------------------------------------------------------------------------

  async function enqueueRow(op: OutboxOp): Promise<void> {
    const houseId = deps.houseId() ?? "";
    await deps.outbox.db.transaction("rw", deps.outbox, async () => {
      const mine = await deps.outbox.where("feedingId").equals(op.feedingId).sortBy("seq");
      const last = mine[mine.length - 1];
      const add = () => deps.outbox.add({ kind: op.kind, feedingId: op.feedingId, payload: op.payload, createdAt: deps.now(), houseId, attempts: 0 } as OutboxRow);
      switch (op.kind) {
        case "create":
          // A sheet retry after a half-failed "feed all" re-queues the same ids: the first row stands.
          if (mine.some((r) => r.kind === "create")) return;
          await add();
          return;
        case "patch":
          if (last && !last.dead && !sending.has(last.seq!)) {
            if (last.kind === "create") { await deps.outbox.update(last.seq!, { payload: applyToCreate(last.payload, op.payload) }); return; }
            if (last.kind === "patch") { await deps.outbox.update(last.seq!, { payload: { ...last.payload, ...op.payload } }); return; }
          }
          await add();
          return;
        case "delete":
          if (mine.some((r) => r.kind === "delete")) return;
          if (mine.length > 0 && !mine.some((r) => sending.has(r.seq!))) {
            // The pending edits die with the feeding; if the server never heard of it, there is nothing to tell it.
            await deps.outbox.bulkDelete(mine.map((r) => r.seq!));
            if (mine.some((r) => r.kind === "create")) return;
          }
          await add();
          return;
      }
    });
  }

  return {
    subscribe(l: () => void) { listeners.add(l); return () => void listeners.delete(l); },
    getSnapshot: () => snapshot,
    refreshPending,
    /** Called with each finished drain run (not when another tab held the lock). Returns an unsubscribe. */
    onDrained(cb: (r: DrainReport) => void): () => void { drainedListeners.add(cb); return () => void drainedListeners.delete(cb); },
    async enqueue(op: OutboxOp): Promise<void> {
      await enqueueRow(op);
      dirty = true;
      await refreshPending();
    },
    drain,
    /**
     * Call when the auth store changes. Rows are kept across sign-out (they may be the only copy of a feeding), but
     * they belong to the house that queued them, so say loudly that they are now stranded.
     */
    sessionChanged(): { houseId: string | null; changed: boolean } {
      const houseId = deps.houseId();
      const changed = houseId !== lastHouse;
      if (changed && lastHouse !== null && snapshot.pending > 0) {
        deps.log.warn("session changed with unsynced feedings left in the outbox", { pending: snapshot.pending, fromHouse: lastHouse, toHouse: houseId });
      }
      lastHouse = houseId;
      if (changed) void refreshPending();
      return { houseId, changed };
    },
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;

export const syncEngine: SyncEngine = createSyncEngine({
  outbox: feedmeDb.outbox,
  api,
  now: Date.now,
  log: appLog,
  houseId: () => { const s = authStore.getSnapshot(); return s.status === "signedIn" ? s.house.id : null; },
});

interface Target { addEventListener(t: string, l: () => void): void; removeEventListener(t: string, l: () => void): void }

/**
 * Drain when connectivity or attention returns. Nothing fires until `markHydrated()`: a drain that finished before the
 * persisted query cache was restored would invalidate queries, and the restore would then put the old data back on top.
 * A fallback timer marks hydration after 10 s so a restore that never settles cannot park the outbox.
 */
export function startSyncTriggers(
  engine: Pick<SyncEngine, "drain"> = syncEngine,
  win: Target = window,
  doc: Target & { visibilityState: string } = document,
): { markHydrated(): void; stop(): void } {
  let hydrated = false;
  const kick = () => { if (hydrated) void engine.drain(); };
  const onVisible = () => { if (doc.visibilityState === "visible") kick(); };
  win.addEventListener("online", kick);
  doc.addEventListener("visibilitychange", onVisible);
  const markHydrated = () => { if (hydrated) return; hydrated = true; kick(); };
  const fallback = setTimeout(markHydrated, 10_000);
  return {
    markHydrated,
    stop() {
      clearTimeout(fallback);
      win.removeEventListener("online", kick);
      doc.removeEventListener("visibilitychange", onVisible);
    },
  };
}
