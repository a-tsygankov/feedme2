// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { FeedmeDb } from "./db.ts";
import { createSyncEngine } from "./sync-engine.ts";
import { ApiError } from "./api-client.ts";

const uuid = () => crypto.randomUUID();
const create = (id: string) => ({ id, catId: uuid(), fedAt: 1, amountMg: 1000, enteredUnit: "g" as const, enteredValue: "1" });

function make(api: Partial<{ createFeedings: unknown; patchFeeding: unknown; deleteFeeding: unknown }>) {
  const db = new FeedmeDb(`t-${Math.random()}`);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const engine = createSyncEngine({ outbox: db.outbox, api: api as never, now: () => 0, log });
  return { engine, db, log };
}

describe("sync engine", () => {
  it("drains in order: a create queued offline, then its patch", async () => {
    const calls: string[] = [];
    const { engine } = make({
      createFeedings: vi.fn(async (items: Array<{ id: string }>) => { calls.push(`create:${items[0]!.id}`); return { accepted: items.map((i) => i.id), feedings: [] }; }),
      patchFeeding: vi.fn(async (id: string) => { calls.push(`patch:${id}`); return {}; }),
    });
    const id = uuid();
    await engine.enqueue({ kind: "create", feedingId: id, payload: create(id) });
    await engine.enqueue({ kind: "patch", feedingId: id, payload: { amountMg: 2000 } });
    expect(engine.getSnapshot().pending).toBe(2);
    expect(await engine.drain()).toEqual({ sent: 2, dropped: 0, stopped: false });
    expect(calls).toEqual([`create:${id}`, `patch:${id}`]);
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
        .mockRejectedValueOnce(new ApiError(404, { error: "not found" }))
        .mockResolvedValueOnce({ accepted: [], feedings: [] }),
    });
    const a = uuid();
    const b = uuid();
    await engine.enqueue({ kind: "create", feedingId: a, payload: create(a) });
    await engine.enqueue({ kind: "create", feedingId: b, payload: create(b) });
    expect(await engine.drain()).toEqual({ sent: 1, dropped: 1, stopped: false });
    expect(log.error).toHaveBeenCalledWith("sync op dropped", expect.objectContaining({ status: 404 }));
  });

  it("a 401 stops the drain without dropping anything", async () => {
    const { engine } = make({ createFeedings: vi.fn(async () => { throw new ApiError(401, {}); }) });
    const id = uuid();
    await engine.enqueue({ kind: "create", feedingId: id, payload: create(id) });
    expect(await engine.drain()).toEqual({ sent: 0, dropped: 0, stopped: true });
    expect(engine.getSnapshot().pending).toBe(1);
  });
});
