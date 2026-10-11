// @vitest-environment node
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FeedmeDb } from "./db.ts";
import { createSyncEngine, MAX_ATTEMPTS, startSyncTriggers, type DrainReport } from "./sync-engine.ts";
import { ApiError, NetworkError } from "./api-client.ts";

const uuid = () => crypto.randomUUID();
const create = (id: string, over: Record<string, unknown> = {}) => ({ id, catId: uuid(), fedAt: 1, amountMg: 1000, enteredUnit: "g" as const, enteredValue: "1", ...over });
const ok = (items: Array<{ id: string }>) => ({ accepted: items.map((i) => i.id), feedings: [] });

interface Opts {
  house?: { current: string | null };
  dbName?: string;
  locks?: unknown;
  visible?: () => boolean;
  schedule?: (fn: () => void, ms: number) => () => void;
}
function make(api: Partial<{ createFeedings: unknown; patchFeeding: unknown; deleteFeeding: unknown }>, o: Opts = {}) {
  const db = new FeedmeDb(o.dbName ?? `t-${Math.random()}`, () => "h1");
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const house = o.house ?? { current: "h1" };
  const engine = createSyncEngine({
    outbox: db.outbox, api: api as never, now: () => 0, log, houseId: () => house.current,
    locks: (o.locks ?? null) as never, ...(o.visible ? { isVisible: o.visible } : {}), ...(o.schedule ? { schedule: o.schedule } : {}),
  });
  return { engine, db, log, house };
}
const rows = (db: FeedmeDb) => db.outbox.orderBy("seq").toArray();
const gate = () => { let release!: () => void; const p = new Promise<void>((r) => { release = r; }); return { p, release }; };

describe("sync engine", () => {
  it("drains in queue order across kinds", async () => {
    const calls: string[] = [];
    const { engine } = make({
      createFeedings: vi.fn(async (items: Array<{ id: string }>) => { calls.push(`create:${items.map((i) => i.id).join("+")}`); return ok(items); }),
      patchFeeding: vi.fn(async (id: string) => { calls.push(`patch:${id}`); return {}; }),
      deleteFeeding: vi.fn(async (id: string) => { calls.push(`delete:${id}`); return null; }),
    });
    const [a, b, c, d] = [uuid(), uuid(), uuid(), uuid()];
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    await engine.enqueue({ kind: "patch", feedingId: b, payload: { amountMg: 2000 } });
    await engine.enqueue({ kind: "delete", feedingId: c, payload: null });
    await engine.enqueue({ kind: "create", feedingId: d, payload: create(d) });
    expect(engine.getSnapshot().pending).toBe(4);
    expect(await engine.drain()).toEqual({ sent: 4, dropped: 0, stopped: false });
    expect(calls).toEqual([`create:${a}`, `patch:${b}`, `delete:${c}`, `create:${d}`]);
    expect(engine.getSnapshot()).toEqual({ pending: 0, status: "idle" });
  });

  it("stops at the first unreachable op and keeps it for later", async () => {
    const { engine } = make({ createFeedings: vi.fn(async () => { throw new TypeError("Failed to fetch"); }) });
    const id = uuid();
    await engine.enqueue({ kind: "create", feedingId: id, payload: create(id) });
    expect(await engine.drain()).toEqual({ sent: 0, dropped: 0, stopped: true });
    expect(engine.getSnapshot()).toEqual({ pending: 1, status: "offline" });
  });

  it("drops an op the server rejects (4xx) and logs it, then continues", async () => {
    const { engine, log } = make({
      createFeedings: vi.fn()
        .mockRejectedValueOnce(new ApiError(404, { error: "cat_not_found" }))
        .mockImplementationOnce(async (items: Array<{ id: string }>) => ok(items)),
      patchFeeding: vi.fn(async () => ({})),
    });
    const a = uuid();
    const b = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    await engine.enqueue({ kind: "patch", feedingId: b, payload: { amountMg: 5 } });
    expect(await engine.drain()).toEqual({ sent: 1, dropped: 1, stopped: false });
    expect(log.error).toHaveBeenCalledWith("sync op dropped", expect.objectContaining({ status: 404, reason: "cat_not_found" }));
  });

  it("a 401 stops the drain without dropping anything, status error, no attempt counted", async () => {
    const { engine, db } = make({ createFeedings: vi.fn(async () => { throw new ApiError(401, {}); }) });
    const id = uuid();
    await engine.enqueue({ kind: "create", feedingId: id, payload: create(id) });
    expect(await engine.drain()).toEqual({ sent: 0, dropped: 0, stopped: true });
    expect(engine.getSnapshot()).toEqual({ pending: 1, status: "error" });
    expect((await rows(db))[0]!.attempts).toBe(0);
  });
});

describe("enqueue during a drain (review: a feeding logged mid-sync was left behind)", () => {
  it("sends an op enqueued while the previous send is in flight, in the same drain() call", async () => {
    const g = gate();
    const sent: string[] = [];
    const createFeedings = vi.fn(async (items: Array<{ id: string }>) => {
      sent.push(...items.map((i) => i.id));
      if (sent.length === 1) await g.p;
      return ok(items);
    });
    const { engine } = make({ createFeedings });
    const a = uuid();
    const b = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    const drained = engine.drain();
    await vi.waitFor(() => expect(createFeedings).toHaveBeenCalledTimes(1));
    await engine.enqueue({ kind: "create", feedingId: b, payload: create(b) });
    g.release();
    const r = await drained;
    expect(sent).toEqual([a, b]);
    expect(r).toEqual({ sent: 2, dropped: 0, stopped: false });
    expect(engine.getSnapshot().pending).toBe(0);
  });

  it("concurrent drain() calls share one send", async () => {
    const createFeedings = vi.fn(async (items: Array<{ id: string }>) => ok(items));
    const { engine } = make({ createFeedings });
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    const [r1, r2] = await Promise.all([engine.drain(), engine.drain()]);
    expect(createFeedings).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    expect(r1.sent).toBe(1);
  });

  it("an edit queued while the create is in flight is not merged into the row about to be deleted", async () => {
    const g = gate();
    const patchFeeding = vi.fn(async () => ({}));
    const createFeedings = vi.fn(async (items: Array<{ id: string }>) => { await g.p; return ok(items); });
    const { engine } = make({ createFeedings, patchFeeding });
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    const drained = engine.drain();
    await vi.waitFor(() => expect(createFeedings).toHaveBeenCalled());
    await engine.enqueue({ kind: "patch", feedingId: a, payload: { amountMg: 9 } });
    g.release();
    expect(await drained).toEqual({ sent: 2, dropped: 0, stopped: false });
    expect(patchFeeding).toHaveBeenCalledWith(a, { amountMg: 9 }, expect.anything());
  });
});

describe("outcome channel", () => {
  it("onDrained reports sent and dropped (with reason) once per run, and unsubscribes", async () => {
    const { engine } = make({
      createFeedings: vi.fn().mockRejectedValueOnce(new ApiError(409, { error: "id_conflict", ids: ["x"] })),
    });
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    const seen: DrainReport[] = [];
    const off = engine.onDrained((r) => seen.push(r));
    await engine.drain();
    expect(seen).toEqual([{ sent: 0, dropped: [{ kind: "create", feedingId: a, status: 409, reason: "id_conflict" }] }]);
    off();
    await engine.drain();
    expect(seen).toHaveLength(1);
  });

  it("a throwing listener does not break the drain", async () => {
    const { engine, log } = make({ createFeedings: vi.fn(async (i: Array<{ id: string }>) => ok(i)) });
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    engine.onDrained(() => { throw new Error("boom"); });
    expect((await engine.drain()).sent).toBe(1);
    expect(log.warn).toHaveBeenCalledWith("onDrained listener threw", expect.anything());
  });
});

describe("failure classification", () => {
  const attempt = async (err: unknown) => {
    const { engine, db } = make({ createFeedings: vi.fn(async () => { throw err; }) });
    const id = uuid();
    await engine.enqueue({ kind: "create", feedingId: id, payload: create(id) });
    const result = await engine.drain();
    return { result, snapshot: engine.getSnapshot(), left: await rows(db) };
  };

  it.each([408, 425, 429, 500, 502, 503])("%i keeps the op, status error, and counts an attempt", async (status) => {
    const { result, snapshot, left } = await attempt(new ApiError(status, null));
    expect(result).toEqual({ sent: 0, dropped: 0, stopped: true });
    expect(snapshot).toEqual({ pending: 1, status: "error" });
    expect(left[0]!.attempts).toBe(1);
  });

  it.each([
    ["NetworkError", new NetworkError()],
    ["TypeError", new TypeError("Failed to fetch")],
    ["AbortError", Object.assign(new Error("aborted"), { name: "AbortError" })],
    ["TimeoutError", Object.assign(new Error("timed out"), { name: "TimeoutError" })],
  ])("%s keeps the op, status offline, and does not count an attempt", async (_n, err) => {
    const { snapshot, left } = await attempt(err);
    expect(snapshot).toEqual({ pending: 1, status: "offline" });
    expect(left[0]!.attempts).toBe(0);
  });

  it.each([400, 403, 404, 409, 410, 413, 422])("%i drops the op", async (status) => {
    const { result, snapshot, left } = await attempt(new ApiError(status, null));
    expect(result).toEqual({ sent: 0, dropped: 1, stopped: false });
    expect(snapshot).toEqual({ pending: 0, status: "idle" });
    expect(left).toEqual([]);
  });

  it("an unexpected error is a stop with status error, not a crash", async () => {
    const { result, snapshot } = await attempt(new RangeError("who knows"));
    expect(result.stopped).toBe(true);
    expect(snapshot.status).toBe("error");
  });

  it("a ZodError parsing a 2xx body counts as sent (the server took it)", async () => {
    let zerr: unknown;
    try { z.object({ accepted: z.array(z.string()) }).parse({}); } catch (e) { zerr = e; }
    const { result, left } = await attempt(zerr);
    expect(result).toEqual({ sent: 1, dropped: 0, stopped: false });
    expect(left).toEqual([]);
  });

  it(`parks an op after ${MAX_ATTEMPTS} failed attempts, reports it, and stops blocking the queue`, async () => {
    const poison = uuid();
    const next = uuid();
    const patchFeeding = vi.fn(async (id: string) => { if (id === poison) throw new ApiError(500, null); return {}; });
    const { engine, db } = make({ patchFeeding });
    await engine.enqueue({ kind: "patch", feedingId: poison, payload: { amountMg: 1 } });
    await engine.enqueue({ kind: "patch", feedingId: next, payload: { amountMg: 2 } });
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) expect((await engine.drain()).stopped).toBe(true);
    const seen: DrainReport[] = [];
    engine.onDrained((r) => seen.push(r));
    const last = await engine.drain();
    expect(last).toEqual({ sent: 1, dropped: 1, stopped: false });
    expect(seen[0]!.dropped).toEqual([{ kind: "patch", feedingId: poison, status: 500, reason: "too many attempts" }]);
    const left = await rows(db);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ feedingId: poison, dead: 1 });
    expect(engine.getSnapshot().pending).toBe(0);
    // Parked rows are never sent again.
    patchFeeding.mockClear();
    await engine.drain();
    expect(patchFeeding).not.toHaveBeenCalled();
  });

  it("status follows the cause of the latest stop and returns to idle after a clean drain", async () => {
    const createFeedings = vi.fn()
      .mockRejectedValueOnce(new NetworkError())
      .mockRejectedValueOnce(new ApiError(503, null))
      .mockImplementation(async (i: Array<{ id: string }>) => ok(i));
    const { engine } = make({ createFeedings });
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    await engine.drain();
    expect(engine.getSnapshot().status).toBe("offline");
    await engine.drain();
    expect(engine.getSnapshot().status).toBe("error");
    await engine.drain();
    expect(engine.getSnapshot()).toEqual({ pending: 0, status: "idle" });
  });

  it("does not flip to syncing when the outbox is empty", async () => {
    const { engine } = make({});
    const seen: string[] = [];
    engine.subscribe(() => seen.push(engine.getSnapshot().status));
    await engine.drain();
    expect(seen).not.toContain("syncing");
  });

  it("an unexpected throw inside a pass still ends the run and resets the status", async () => {
    const { engine, db } = make({ createFeedings: vi.fn(async (i: Array<{ id: string }>) => ok(i)) });
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    vi.spyOn(db.outbox, "delete").mockRejectedValueOnce(new Error("disk full"));
    const r = await engine.drain();
    expect(r.stopped).toBe(true);
    expect(engine.getSnapshot().status).toBe("error");
    // And the engine is not wedged.
    expect((await engine.drain()).stopped).toBe(false);
  });

  it("refreshPending swallows a failing count", async () => {
    const { engine, db, log } = make({});
    vi.spyOn(db.outbox, "filter").mockImplementation(() => { throw new Error("idb gone"); });
    await expect(engine.refreshPending()).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith("sync pending count failed", expect.anything());
  });
});

describe("accepted ids are honoured", () => {
  it("a create the server did not accept is dropped as 'not accepted'", async () => {
    const { engine } = make({ createFeedings: vi.fn(async () => ({ accepted: [], feedings: [] })) });
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    const seen: DrainReport[] = [];
    engine.onDrained((r) => seen.push(r));
    expect(await engine.drain()).toEqual({ sent: 0, dropped: 1, stopped: false });
    expect(seen[0]!.dropped[0]).toMatchObject({ feedingId: a, reason: "not accepted", status: null });
  });

  it("not accepted but returned in `feedings` (it already existed) counts as sent", async () => {
    const a = uuid();
    const { engine } = make({ createFeedings: vi.fn(async () => ({ accepted: [], feedings: [{ id: a }] })) });
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    expect(await engine.drain()).toEqual({ sent: 1, dropped: 0, stopped: false });
  });
});

describe("house scoping", () => {
  it("sends only the signed-in house's rows and leaves the others queued", async () => {
    const house = { current: "h1" as string | null };
    const createFeedings = vi.fn(async (i: Array<{ id: string }>) => ok(i));
    const { engine, db } = make({ createFeedings }, { house });
    const a = uuid();
    const b = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    house.current = "h2";
    await engine.enqueue({ kind: "create", feedingId: b, payload: create(b) });
    expect(engine.getSnapshot().pending).toBe(1);
    await engine.drain();
    expect(createFeedings).toHaveBeenCalledTimes(1);
    expect(createFeedings.mock.calls[0]![0]).toEqual([expect.objectContaining({ id: b })]);
    expect((await rows(db)).map((r) => [r.feedingId, r.houseId])).toEqual([[a, "h1"]]);
    house.current = "h1";
    await engine.drain();
    expect(await rows(db)).toEqual([]);
  });

  it("signed out: nothing is sent, rows stay, pending is 0", async () => {
    const house = { current: "h1" as string | null };
    const createFeedings = vi.fn();
    const { engine, db } = make({ createFeedings }, { house });
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    house.current = null;
    await engine.drain();
    expect(createFeedings).not.toHaveBeenCalled();
    expect(await rows(db)).toHaveLength(1);
    expect(engine.getSnapshot().pending).toBe(0);
  });

  it("sessionChanged warns when sign-out strands queued feedings, and reports a sign-in", async () => {
    const house = { current: "h1" as string | null };
    const { engine, log } = make({}, { house });
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    house.current = null;
    expect(engine.sessionChanged()).toEqual({ houseId: null, changed: true });
    expect(log.warn).toHaveBeenCalledWith("session changed with unsynced feedings left in the outbox", expect.objectContaining({ pending: 1 }));
    expect(engine.sessionChanged().changed).toBe(false);
    house.current = "h1";
    expect(engine.sessionChanged()).toEqual({ houseId: "h1", changed: true });
    await vi.waitFor(() => expect(engine.getSnapshot().pending).toBe(1));
  });

  it("legacy rows (houseId '') are adopted by the house that drains first", async () => {
    const createFeedings = vi.fn(async (i: Array<{ id: string }>) => ok(i));
    const { engine, db } = make({ createFeedings });
    const a = uuid();
    await db.outbox.add({ kind: "create", feedingId: a, payload: create(a), createdAt: 0, houseId: "", attempts: 0 });
    await engine.refreshPending();
    expect(engine.getSnapshot().pending).toBe(1);
    expect((await engine.drain()).sent).toBe(1);
  });
});

describe("coalescing per feeding id", () => {
  const unsent = async () => {
    const m = make({});
    return m;
  };

  it("a patch onto a pending create is merged into the create", async () => {
    const { engine, db } = await unsent();
    const a = uuid();
    const original = create(a, { note: "x" });
    await engine.enqueue({ kind: "create", feedingId: a, payload: original });
    await engine.enqueue({ kind: "patch", feedingId: a, payload: { amountMg: 5000, enteredUnit: "g", enteredValue: "5", note: null } });
    const left = await rows(db);
    expect(left).toHaveLength(1);
    expect(left[0]!.kind).toBe("create");
    expect(left[0]!.payload).toEqual({ ...original, amountMg: 5000, enteredValue: "5", note: undefined });
    expect(left[0]!.payload).not.toHaveProperty("note");
    expect(engine.getSnapshot().pending).toBe(1);
  });

  it("a patch onto a pending patch is merged", async () => {
    const { engine, db } = await unsent();
    const a = uuid();
    await engine.enqueue({ kind: "patch", feedingId: a, payload: { amountMg: 1, enteredUnit: "g", enteredValue: "0.001" } });
    await engine.enqueue({ kind: "patch", feedingId: a, payload: { note: "later", amountMg: 2, enteredUnit: "g", enteredValue: "0.002" } });
    const left = await rows(db);
    expect(left).toHaveLength(1);
    expect(left[0]!.payload).toEqual({ amountMg: 2, enteredUnit: "g", enteredValue: "0.002", note: "later" });
  });

  it("a delete of a pending create removes it (and its patches) and queues nothing", async () => {
    const { engine, db } = await unsent();
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    await engine.enqueue({ kind: "delete", feedingId: a, payload: null });
    expect(await rows(db)).toEqual([]);
    expect(engine.getSnapshot().pending).toBe(0);
  });

  it("a delete after a pending patch replaces the patch with the delete", async () => {
    const { engine, db } = await unsent();
    const a = uuid();
    await engine.enqueue({ kind: "patch", feedingId: a, payload: { amountMg: 3 } });
    await engine.enqueue({ kind: "delete", feedingId: a, payload: null });
    const left = await rows(db);
    expect(left.map((r) => r.kind)).toEqual(["delete"]);
  });

  it("a second delete, and a re-queued create with the same id, are no-ops", async () => {
    const { engine, db } = await unsent();
    const a = uuid();
    await engine.enqueue({ kind: "delete", feedingId: a, payload: null });
    await engine.enqueue({ kind: "delete", feedingId: a, payload: null });
    expect(await rows(db)).toHaveLength(1);
    const b = uuid();
    await engine.enqueue({ kind: "create", feedingId: b, payload: create(b) });
    await engine.enqueue({ kind: "create", feedingId: b, payload: create(b) });
    expect(await rows(db)).toHaveLength(2);
  });

  it("different feedings do not coalesce", async () => {
    const { engine, db } = await unsent();
    const a = uuid();
    const b = uuid();
    await engine.enqueue({ kind: "patch", feedingId: a, payload: { amountMg: 3 } });
    await engine.enqueue({ kind: "patch", feedingId: b, payload: { amountMg: 4 } });
    expect(await rows(db)).toHaveLength(2);
  });
});

describe("batching", () => {
  it("sends consecutive creates in one POST, in order, at most 100 at a time", async () => {
    const batches: string[][] = [];
    const { engine } = make({ createFeedings: vi.fn(async (items: Array<{ id: string }>) => { batches.push(items.map((i) => i.id)); return ok(items); }) });
    const ids = Array.from({ length: 105 }, () => uuid());
    for (const id of ids) await engine.enqueue({ kind: "create", feedingId: id, payload: create(id) });
    expect(await engine.drain()).toEqual({ sent: 105, dropped: 0, stopped: false });
    expect(batches.map((b) => b.length)).toEqual([100, 5]);
    expect(batches.flat()).toEqual(ids);
  });

  it("a patch between creates splits the batch so order is preserved", async () => {
    const calls: string[] = [];
    const { engine } = make({
      createFeedings: vi.fn(async (items: Array<{ id: string }>) => { calls.push(`create×${items.length}`); return ok(items); }),
      patchFeeding: vi.fn(async () => { calls.push("patch"); return {}; }),
    });
    const [a, b, c] = [uuid(), uuid(), uuid()];
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    await engine.enqueue({ kind: "create", feedingId: b, payload: create(b) });
    await engine.enqueue({ kind: "patch", feedingId: uuid(), payload: { amountMg: 1 } });
    await engine.enqueue({ kind: "create", feedingId: c, payload: create(c) });
    await engine.drain();
    expect(calls).toEqual(["create×2", "patch", "create×1"]);
  });

  it("a refused batch falls back to one-by-one so one poison item does not drop its neighbours", async () => {
    const [a, bad, c] = [uuid(), uuid(), uuid()];
    const createFeedings = vi.fn(async (items: Array<{ id: string }>) => {
      if (items.some((i) => i.id === bad)) throw new ApiError(404, { error: "cat_not_found", catIds: ["x"] });
      return ok(items);
    });
    const { engine, db } = make({ createFeedings });
    for (const id of [a, bad, c]) await engine.enqueue({ kind: "create", feedingId: id, payload: create(id) });
    const seen: DrainReport[] = [];
    engine.onDrained((r) => seen.push(r));
    expect(await engine.drain()).toEqual({ sent: 2, dropped: 1, stopped: false });
    expect(seen[0]!.dropped.map((d) => d.feedingId)).toEqual([bad]);
    expect(createFeedings.mock.calls.map((c0) => (c0[0] as unknown[]).length)).toEqual([3, 1, 1, 1]);
    expect(await rows(db)).toEqual([]);
  });

  it("a network failure on a batch stops without falling back", async () => {
    const createFeedings = vi.fn(async () => { throw new NetworkError(); });
    const { engine } = make({ createFeedings });
    for (let i = 0; i < 3; i++) { const id = uuid(); await engine.enqueue({ kind: "create", feedingId: id, payload: create(id) }); }
    expect((await engine.drain()).stopped).toBe(true);
    expect(createFeedings).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot()).toEqual({ pending: 3, status: "offline" });
  });

  it("a 5xx on a batch is retried singly too, and the first single failure stops", async () => {
    const createFeedings = vi.fn(async () => { throw new ApiError(500, null); });
    const { engine, db } = make({ createFeedings });
    for (let i = 0; i < 3; i++) { const id = uuid(); await engine.enqueue({ kind: "create", feedingId: id, payload: create(id) }); }
    expect((await engine.drain()).stopped).toBe(true);
    expect(createFeedings).toHaveBeenCalledTimes(2);
    expect((await rows(db)).map((r) => r.attempts)).toEqual([1, 0, 0]);
  });
});

describe("persistence", () => {
  it("a new engine on the same database sees what the old one queued (a reload)", async () => {
    const name = `reload-${Math.random()}`;
    const first = make({}, { dbName: name });
    const a = uuid();
    await first.engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    first.db.close();
    const second = make({ createFeedings: vi.fn(async (i: Array<{ id: string }>) => ok(i)) }, { dbName: name });
    await vi.waitFor(() => expect(second.engine.getSnapshot().pending).toBe(1));
    expect((await second.engine.drain()).sent).toBe(1);
  });

  it("upgrades a v1 outbox: rows get attempts 0 and the signed-in house", async () => {
    const name = `v1-${Math.random()}`;
    const old = new Dexie(name);
    old.version(1).stores({ outbox: "++seq, feedingId", kv: "key" });
    await old.table("outbox").add({ kind: "delete", feedingId: "f1", payload: null, createdAt: 5 });
    old.close();
    const db = new FeedmeDb(name, () => "h-now");
    expect(await db.outbox.toArray()).toEqual([expect.objectContaining({ feedingId: "f1", attempts: 0, houseId: "h-now", createdAt: 5 })]);
    db.close();
  });
});

describe("two tabs", () => {
  const fakeLocks = (held: boolean) => ({ request: vi.fn(async (_n: string, _o: unknown, cb: (l: unknown) => Promise<unknown>) => cb(held ? null : {})) });

  it("skips the run when another tab holds the lock: nothing sent, status unchanged, no outcome emitted", async () => {
    const createFeedings = vi.fn();
    const locks = fakeLocks(true);
    const { engine } = make({ createFeedings }, { locks });
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    const seen: DrainReport[] = [];
    engine.onDrained((r) => seen.push(r));
    expect(await engine.drain()).toEqual({ sent: 0, dropped: 0, stopped: false });
    expect(createFeedings).not.toHaveBeenCalled();
    expect(engine.getSnapshot()).toEqual({ pending: 1, status: "idle" });
    expect(seen).toEqual([]);
    expect(locks.request).toHaveBeenCalledWith("feedme2-sync", { ifAvailable: true }, expect.any(Function));
  });

  it("drains normally when the lock is free", async () => {
    const { engine } = make({ createFeedings: vi.fn(async (i: Array<{ id: string }>) => ok(i)) }, { locks: fakeLocks(false) });
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    expect((await engine.drain()).sent).toBe(1);
  });
});

describe("retry timer", () => {
  function timers() {
    const scheduled: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
    return {
      scheduled,
      schedule: (fn: () => void, ms: number) => { const t = { fn, ms, cancelled: false }; scheduled.push(t); return () => { t.cancelled = true; }; },
    };
  }

  it("retries on a 15 s doubling delay (cap 5 min) while pending, and stops once a drain succeeds", async () => {
    const t = timers();
    const createFeedings = vi.fn<(items: Array<{ id: string }>) => Promise<unknown>>(async () => { throw new NetworkError(); });
    const { engine } = make({ createFeedings }, { schedule: t.schedule });
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    await engine.drain();
    expect(t.scheduled.map((s) => s.ms)).toEqual([15_000]);
    t.scheduled[0]!.fn();
    await vi.waitFor(() => expect(t.scheduled).toHaveLength(2));
    expect(t.scheduled[1]!.ms).toBe(30_000);
    for (let i = 2; i < 9; i++) {
      t.scheduled[i - 1]!.fn();
      await vi.waitFor(() => expect(t.scheduled).toHaveLength(i + 1));
    }
    expect(Math.max(...t.scheduled.map((s) => s.ms))).toBe(300_000);
    createFeedings.mockImplementation(async (i: Array<{ id: string }>) => ok(i));
    const last = t.scheduled.at(-1)!;
    last.fn();
    await vi.waitFor(() => expect(engine.getSnapshot().pending).toBe(0));
    expect(t.scheduled.at(-1)).toBe(last);
    // Backoff resets after success.
    createFeedings.mockImplementation(async () => { throw new NetworkError(); });
    const b = uuid();
    await engine.enqueue({ kind: "create", feedingId: b, payload: create(b) });
    await engine.drain();
    expect(t.scheduled.at(-1)!.ms).toBe(15_000);
  });

  it("does not schedule while the page is hidden", async () => {
    const t = timers();
    const { engine } = make({ createFeedings: vi.fn(async () => { throw new NetworkError(); }) }, { schedule: t.schedule, visible: () => false });
    const a = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    await engine.drain();
    expect(t.scheduled).toEqual([]);
  });
});

describe("startSyncTriggers", () => {
  it("holds every kick until hydration, then drains; stop removes the listeners", () => {
    vi.useFakeTimers();
    try {
      const win = new EventTarget();
      const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
      const drain = vi.fn();
      const t = startSyncTriggers({ drain } as never, win as never, doc as never);
      win.dispatchEvent(new Event("online"));
      doc.dispatchEvent(new Event("visibilitychange"));
      expect(drain).not.toHaveBeenCalled();
      t.markHydrated();
      expect(drain).toHaveBeenCalledTimes(1);
      win.dispatchEvent(new Event("online"));
      expect(drain).toHaveBeenCalledTimes(2);
      doc.visibilityState = "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
      expect(drain).toHaveBeenCalledTimes(2);
      t.stop();
      win.dispatchEvent(new Event("online"));
      expect(drain).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to hydrated after 10 s if the restore never settles", () => {
    vi.useFakeTimers();
    try {
      const drain = vi.fn();
      const t = startSyncTriggers({ drain } as never, new EventTarget() as never, Object.assign(new EventTarget(), { visibilityState: "visible" }) as never);
      vi.advanceTimersByTime(10_000);
      expect(drain).toHaveBeenCalledTimes(1);
      t.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
