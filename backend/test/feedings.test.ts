import { CatSchema, FeedingsPageSchema } from "@feedme2/shared";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clock } from "../src/auth/tokens.ts";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";

const id = () => crypto.randomUUID();
const feeding = (catId: string, fedAt: number, amountMg = 40000) => ({
  id: id(), catId, fedAt, amountMg, enteredUnit: "g", enteredValue: String(amountMg / 1000),
});

type Session = Awaited<ReturnType<typeof signup>>;

async function addCat(s: Session, name = "Luna") {
  const catId = id();
  await s.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: catId, name }) });
  return catId;
}

async function houseWithCat() {
  const s = await signup();
  const catId = await addCat(s, "Mochi");
  return { s, catId };
}

type CatRow = {
  id: string; modifiedAt: number; lastFedAt: number | null; defaultAmountMg: number | null; defaultEnteredUnit: string | null; defaultEnteredValue: string | null;
};
async function listCats(s: Session) {
  return ((await (await s.fetchAuthed("/api/cats")).json()) as { cats: CatRow[] }).cats;
}

const post = (s: Session, items: unknown[]) => s.fetchAuthed("/api/feedings", { method: "POST", body: JSON.stringify(items) });
const pageOf = async (s: Session, qs: string) => FeedingsPageSchema.parse(await (await s.fetchAuthed(`/api/feedings?${qs}`)).json());

const patch = (s: Session, fid: string, body: unknown) => s.fetchAuthed(`/api/feedings/${fid}`, { method: "PATCH", body: JSON.stringify(body) });
const del = (s: Session, fid: string) => s.fetchAuthed(`/api/feedings/${fid}`, { method: "DELETE" });

describe("/api/feedings", () => {
  beforeAll(applyAllMigrations);
  afterEach(() => vi.mocked(clock.now).mockRestore?.());

  it("batch create is idempotent and updates the cat's last_fed_at and defaults", async () => {
    const { s, catId } = await houseWithCat();
    const f1 = feeding(catId, 1_000_000);
    const f2 = { ...feeding(catId, 2_000_000, 51974), enteredUnit: "can", enteredValue: "1/3" };
    const r = await post(s, [f1, f2, f1]);
    expect(r.status).toBe(201);
    const body = (await r.json()) as { accepted: string[]; feedings: unknown[] };
    expect(body.accepted.sort()).toEqual([f1.id, f2.id].sort());
    expect(body.feedings).toHaveLength(2);
    const cat = CatSchema.parse((await listCats(s))[0]);
    expect(cat.lastFedAt).toBe(2_000_000);
    expect(cat.defaultAmountMg).toBe(51974);
    expect(cat.defaultEnteredUnit).toBe("can");
    expect(cat.defaultEnteredValue).toBe("1/3");
  });

  it("pages newest first with a compound cursor, filters by cat and range", async () => {
    const { s, catId } = await houseWithCat();
    const other = await addCat(s);
    const items = [1, 2, 3, 4, 5].map((n) => feeding(catId, n * 1000));
    items.push(feeding(other, 9000));
    await post(s, items);
    const p1 = await pageOf(s, `cat=${catId}&limit=2`);
    expect(p1.items.map((f) => f.fedAt)).toEqual([5000, 4000]);
    expect(typeof p1.nextCursor).toBe("string");
    expect(p1.nextCursor!.startsWith("4000:")).toBe(true);
    const p2 = await pageOf(s, `cat=${catId}&limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}`);
    expect(p2.items.map((f) => f.fedAt)).toEqual([3000, 2000]);
    const ranged = await pageOf(s, `from=2000&to=3000`);
    expect(ranged.items.map((f) => f.fedAt)).toEqual([3000, 2000]);
    const all = await pageOf(s, `limit=10`);
    expect(all.items).toHaveLength(6);
    expect(all.nextCursor).toBeNull();
  });

  it("does not skip feedings that share a fedAt across a page boundary", async () => {
    const { s, catId } = await houseWithCat();
    const other = await addCat(s);
    const a = feeding(catId, 7000);
    const b = feeding(other, 7000);
    await post(s, [a, b]);
    const p1 = await pageOf(s, "limit=1");
    expect(p1.items).toHaveLength(1);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await pageOf(s, `limit=1&cursor=${encodeURIComponent(p1.nextCursor!)}`);
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect([p1.items[0]!.id, p2.items[0]!.id].sort()).toEqual([a.id, b.id].sort());
  });

  it("rejects a malformed cursor", async () => {
    const { s } = await houseWithCat();
    expect((await s.fetchAuthed("/api/feedings?cursor=4000")).status).toBe(400);
  });

  it("accepts the schema maximum of 100 items in one batch (D1 caps bound parameters per statement) and resends are no-ops", async () => {
    const { s, catId } = await houseWithCat();
    const items = Array.from({ length: 100 }, (_, n) => feeding(catId, 1_000 + n));
    const r1 = await post(s, items);
    expect(r1.status).toBe(201);
    const b1 = (await r1.json()) as { accepted: string[]; feedings: unknown[] };
    expect(b1.accepted).toHaveLength(100);
    expect(new Set(b1.accepted).size).toBe(100);
    expect(b1.feedings).toHaveLength(100);
    const r2 = await post(s, items);
    expect(r2.status).toBe(201);
    const b2 = (await r2.json()) as { accepted: string[]; feedings: unknown[] };
    expect(b2.accepted).toHaveLength(0);
    expect(b2.feedings).toHaveLength(100);
    expect((await pageOf(s, "limit=200")).items).toHaveLength(100);
    expect((await listCats(s))[0]?.lastFedAt).toBe(1_099);
  });

  it("rejects an empty batch and one over 100 items", async () => {
    const { s, catId } = await houseWithCat();
    expect((await post(s, [])).status).toBe(400);
    expect((await post(s, Array.from({ length: 101 }, (_, n) => feeding(catId, n + 1)))).status).toBe(400);
  });

  it("patch and delete recompute the cat's defaults; moving a feeding to another cat updates both", async () => {
    const { s, catId } = await houseWithCat();
    const other = await addCat(s);
    const f = feeding(catId, 5_000_000);
    await post(s, [f]);
    const moved = await s.fetchAuthed(`/api/feedings/${f.id}`, { method: "PATCH", body: JSON.stringify({ catId: other, amountMg: 30000, enteredUnit: "g", enteredValue: "30" }) });
    expect(moved.status).toBe(200);
    const cats = await listCats(s);
    expect(cats.find((c) => c.id === catId)?.lastFedAt).toBeNull();
    expect(cats.find((c) => c.id === other)?.defaultAmountMg).toBe(30000);
    expect((await s.fetchAuthed(`/api/feedings/${f.id}`, { method: "DELETE" })).status).toBe(204);
    const after = await listCats(s);
    expect(after.find((c) => c.id === other)?.lastFedAt).toBeNull();
    // DELETE is idempotent: the feeding is gone either way.
    expect((await s.fetchAuthed(`/api/feedings/${f.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await pageOf(s, "limit=10")).items).toHaveLength(0);
  });

  it("cat defaults follow the latest live feeding by fedAt then id, through patch and delete", async () => {
    const { s, catId } = await houseWithCat();
    const older = feeding(catId, 1000, 10000);
    const newer = feeding(catId, 2000, 20000);
    await post(s, [older, newer]);
    expect((await listCats(s))[0]).toMatchObject({ lastFedAt: 2000, defaultAmountMg: 20000 });
    // Back-dating the newest below the older one hands the defaults back to the older.
    const patched = await s.fetchAuthed(`/api/feedings/${newer.id}`, { method: "PATCH", body: JSON.stringify({ fedAt: 500 }) });
    expect(patched.status).toBe(200);
    expect((await listCats(s))[0]).toMatchObject({ lastFedAt: 1000, defaultAmountMg: 10000 });
    await s.fetchAuthed(`/api/feedings/${older.id}`, { method: "DELETE" });
    expect((await listCats(s))[0]).toMatchObject({ lastFedAt: 500, defaultAmountMg: 20000 });
  });

  it("rejects a feeding for a cat of another house with 404 cat_not_found, writing nothing", async () => {
    const { s, catId } = await houseWithCat();
    const s2 = await signup();
    const mine = await addCat(s2, "Mine");
    const r = await post(s2, [feeding(mine, 5), feeding(catId, 1)]);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "cat_not_found", catIds: [catId] });
    expect((await pageOf(s2, "limit=10")).items).toHaveLength(0);
    expect((await pageOf(s, "limit=10")).items).toHaveLength(0);
  });

  it("rejects moving a feeding to a cat of another house and hides other houses' feedings", async () => {
    const { s, catId } = await houseWithCat();
    const s2 = await signup();
    const foreign = await addCat(s2);
    const f = feeding(catId, 1000);
    await post(s, [f]);
    const r = await s.fetchAuthed(`/api/feedings/${f.id}`, { method: "PATCH", body: JSON.stringify({ catId: foreign }) });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "cat_not_found", catIds: [foreign] });
    expect((await s2.fetchAuthed(`/api/feedings/${f.id}`, { method: "PATCH", body: JSON.stringify({ note: "x" }) })).status).toBe(404);
    expect((await s2.fetchAuthed(`/api/feedings/${f.id}`, { method: "DELETE" })).status).toBe(404);
  });

  describe("soft-deleted cats", () => {
    it("still accept feedings: an outbox replay after a cat deletion must not poison the batch", async () => {
      const { s, catId } = await houseWithCat();
      const keep = await addCat(s, "Keeper");
      const f = feeding(catId, 1_000);
      expect((await post(s, [f])).status).toBe(201);
      expect((await s.fetchAuthed(`/api/cats/${catId}`, { method: "DELETE" })).status).toBe(204);

      // Same item again plus a fresh one for the deleted cat and one for a live cat.
      const fresh = feeding(catId, 2_000);
      const other = feeding(keep, 3_000);
      const r = await post(s, [f, fresh, other]);
      expect(r.status).toBe(201);
      const body = (await r.json()) as { accepted: string[]; feedings: Array<{ id: string }> };
      expect(body.accepted.sort()).toEqual([fresh.id, other.id].sort());
      expect(body.feedings.map((x) => x.id)).toEqual([f.id, fresh.id, other.id]);

      const replay = await post(s, [f]);
      expect(replay.status).toBe(201);
      expect(((await replay.json()) as { accepted: string[] }).accepted).toEqual([]);
    });

    it("can be the target of a PATCH move (history stays reachable)", async () => {
      const { s, catId } = await houseWithCat();
      const keep = await addCat(s, "Keeper");
      await s.fetchAuthed(`/api/cats/${catId}`, { method: "DELETE" });
      const f = feeding(keep, 1_000);
      await post(s, [f]);
      expect((await patch(s, f.id, { catId })).status).toBe(200);
    });
  });

  it("reports every missing cat id and writes nothing", async () => {
    const { s, catId } = await houseWithCat();
    const ghost1 = id();
    const ghost2 = id();
    const r = await post(s, [feeding(catId, 1), feeding(ghost1, 2), feeding(ghost2, 3), feeding(ghost1, 4)]);
    expect(r.status).toBe(404);
    const body = (await r.json()) as { error: string; catIds: string[] };
    expect(body.error).toBe("cat_not_found");
    expect(body.catIds.sort()).toEqual([ghost1, ghost2].sort());
    expect((await pageOf(s, "limit=10")).items).toHaveLength(0);
  });

  describe("fedAt bounds", () => {
    it("rejects fedAt 0 on POST and PATCH with 400 invalid_request (the DB CHECK must never answer)", async () => {
      const { s, catId } = await houseWithCat();
      const r = await post(s, [feeding(catId, 0)]);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe("invalid_request");
      const f = feeding(catId, 1_000);
      await post(s, [f]);
      const p = await patch(s, f.id, { fedAt: 0 });
      expect(p.status).toBe(400);
      expect(((await p.json()) as { error: string }).error).toBe("invalid_request");
    });

    it("rejects a fedAt more than 5 minutes ahead of the server clock, whole batch, listing offenders", async () => {
      const { s, catId } = await houseWithCat();
      const now = 10_000_000;
      vi.spyOn(clock, "now").mockReturnValue(now);
      const ok = feeding(catId, now + 300_000);
      const bad = feeding(catId, now + 300_001);
      const r = await post(s, [ok, bad]);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "fedat_in_future", maxMs: now + 300_000, ids: [bad.id] });
      expect((await pageOf(s, "limit=10")).items).toHaveLength(0);
      // The boundary itself is fine.
      expect((await post(s, [ok])).status).toBe(201);

      const p = await patch(s, ok.id, { fedAt: now + 300_001 });
      expect(p.status).toBe(400);
      expect(await p.json()).toEqual({ error: "fedat_in_future", maxMs: now + 300_000 });
      expect((await patch(s, ok.id, { fedAt: now + 300_000 })).status).toBe(200);
    });
  });

  it("answers 409 id_conflict when an id belongs to another house, writing nothing and leaving their row alone", async () => {
    const { s, catId } = await houseWithCat();
    const theirs = feeding(catId, 1_000, 11000);
    await post(s, [theirs]);
    const s2 = await signup();
    const mine = await addCat(s2, "Mine");
    const innocent = feeding(mine, 5_000);
    const r = await post(s2, [innocent, { ...theirs, catId: mine, amountMg: 99000, enteredValue: "99" }]);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "id_conflict", ids: [theirs.id] });
    expect((await pageOf(s2, "limit=10")).items).toHaveLength(0);
    const back = await pageOf(s, "limit=10");
    expect(back.items).toHaveLength(1);
    expect(back.items[0]).toMatchObject({ id: theirs.id, amountMg: 11000, houseId: s.houseId });
  });

  describe("delete", () => {
    it("is idempotent for own deleted feedings and 404 for unknown or foreign ids", async () => {
      const { s, catId } = await houseWithCat();
      const f = feeding(catId, 1_000);
      await post(s, [f]);
      expect((await del(s, f.id)).status).toBe(204);
      expect((await del(s, f.id)).status).toBe(204);
      expect((await del(s, id())).status).toBe(404);
      const s2 = await signup();
      expect((await del(s2, f.id)).status).toBe(404);
    });

    it("a replay of a soft-deleted id lands in neither accepted nor feedings (no resurrection)", async () => {
      const { s, catId } = await houseWithCat();
      const f = feeding(catId, 1_000);
      await post(s, [f]);
      await del(s, f.id);
      const r = await post(s, [f]);
      expect(r.status).toBe(201);
      expect(await r.json()).toEqual({ accepted: [], feedings: [] });
      expect((await pageOf(s, "limit=10")).items).toHaveLength(0);
    });

    it("deleting the last feeding nulls lastFedAt and all three defaults", async () => {
      const { s, catId } = await houseWithCat();
      const f = feeding(catId, 1_000);
      await post(s, [f]);
      expect((await listCats(s))[0]).toMatchObject({ lastFedAt: 1_000, defaultAmountMg: 40000, defaultEnteredUnit: "g", defaultEnteredValue: "40" });
      await del(s, f.id);
      expect((await listCats(s))[0]).toMatchObject({ lastFedAt: null, defaultAmountMg: null, defaultEnteredUnit: null, defaultEnteredValue: null });
    });
  });

  it("stores a valid x-client-id with source web and ignores a malformed one", async () => {
    const { s, catId } = await houseWithCat();
    const a = feeding(catId, 1_000);
    const b = feeding(catId, 2_000);
    const c = feeding(catId, 3_000);
    const send = (f: unknown, clientId: string) =>
      s.fetchAuthed("/api/feedings", { method: "POST", headers: { "x-client-id": clientId }, body: JSON.stringify([f]) });
    await send(a, "tab-7_A");
    await send(b, "has spaces!");
    await send(c, "x".repeat(65));
    const items = (await pageOf(s, "limit=10")).items;
    const by = (fid: string) => items.find((i) => i.id === fid);
    expect(by(a.id)).toMatchObject({ clientId: "tab-7_A", source: "web", deviceId: null });
    expect(by(b.id)).toMatchObject({ clientId: null, source: "web" });
    expect(by(c.id)).toMatchObject({ clientId: null, source: "web" });
  });

  it("a pure replay does not bump the cat's modifiedAt, a real change does", async () => {
    const { s, catId } = await houseWithCat();
    const now = vi.spyOn(clock, "now");
    const f = feeding(catId, 1_000);
    now.mockReturnValue(1_000_000_000_000);
    await post(s, [f]);
    expect((await listCats(s))[0]?.modifiedAt).toBe(1_000_000_000_000);
    now.mockReturnValue(1_000_000_001_000);
    await post(s, [f]);
    expect((await patch(s, f.id, { note: "same defaults" })).status).toBe(200);
    expect((await listCats(s))[0]?.modifiedAt).toBe(1_000_000_000_000);
    now.mockReturnValue(1_000_000_002_000);
    await patch(s, f.id, { amountMg: 1234, enteredUnit: "g", enteredValue: "1.2" });
    expect((await listCats(s))[0]?.modifiedAt).toBe(1_000_000_002_000);
  });

  it("returns feedings in request order", async () => {
    const { s, catId } = await houseWithCat();
    const items = [5, 1, 4, 2, 3].map((n) => feeding(catId, n * 1000));
    const body = (await (await post(s, items)).json()) as { feedings: Array<{ id: string }> };
    expect(body.feedings.map((f) => f.id)).toEqual(items.map((i) => i.id));
  });

  it("ties on fedAt for one cat take the defaults from the larger id", async () => {
    const { s, catId } = await houseWithCat();
    const small = { ...feeding(catId, 4_000, 10000), id: "00000000-0000-4000-8000-000000000001" };
    const large = { ...feeding(catId, 4_000, 20000), id: "00000000-0000-4000-8000-000000000002" };
    // Insert the larger id first so insertion order cannot be what decides it.
    await post(s, [large]);
    await post(s, [small]);
    expect((await listCats(s))[0]).toMatchObject({ lastFedAt: 4_000, defaultAmountMg: 20000 });
  });

  it("a multi-cat batch refreshes each cat with its own latest feeding", async () => {
    const { s, catId } = await houseWithCat();
    const other = await addCat(s);
    await post(s, [feeding(catId, 1_000, 10000), feeding(other, 2_000, 20000), feeding(catId, 3_000, 30000), feeding(other, 1_500, 15000)]);
    const cats = await listCats(s);
    expect(cats.find((c) => c.id === catId)).toMatchObject({ lastFedAt: 3_000, defaultAmountMg: 30000 });
    expect(cats.find((c) => c.id === other)).toMatchObject({ lastFedAt: 2_000, defaultAmountMg: 20000 });
  });

  it("concurrent identical POSTs accept each item exactly once between them", async () => {
    const { s, catId } = await houseWithCat();
    const items = Array.from({ length: 10 }, (_, n) => feeding(catId, 1_000 + n));
    const [a, b] = await Promise.all([post(s, items), post(s, items)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const accA = ((await a.json()) as { accepted: string[] }).accepted;
    const accB = ((await b.json()) as { accepted: string[] }).accepted;
    expect(accA.filter((x) => accB.includes(x))).toEqual([]);
    expect([...accA, ...accB].sort()).toEqual(items.map((i) => i.id).sort());
    expect((await listCats(s))[0]?.lastFedAt).toBe(1_009);
    expect((await pageOf(s, "limit=200")).items).toHaveLength(10);
  });

  describe("query and body validation", () => {
    it("limit must be 1..200", async () => {
      const { s } = await houseWithCat();
      expect((await s.fetchAuthed("/api/feedings?limit=0")).status).toBe(400);
      expect((await s.fetchAuthed("/api/feedings?limit=201")).status).toBe(400);
      expect((await s.fetchAuthed("/api/feedings?limit=200")).status).toBe(200);
    });

    it("from and to are capped like fedAt; to < from is an empty page", async () => {
      const { s, catId } = await houseWithCat();
      await post(s, [feeding(catId, 5_000)]);
      expect((await s.fetchAuthed("/api/feedings?from=4102444800001")).status).toBe(400);
      expect((await s.fetchAuthed("/api/feedings?to=4102444800001")).status).toBe(400);
      const r = await s.fetchAuthed("/api/feedings?from=9000&to=1000");
      expect(r.status).toBe(200);
      expect(FeedingsPageSchema.parse(await r.json())).toEqual({ items: [], nextCursor: null });
    });

    it("PATCH note null clears the note; a note over 200 chars is a 400 on POST and PATCH", async () => {
      const { s, catId } = await houseWithCat();
      const f = { ...feeding(catId, 1_000), note: "dry" };
      await post(s, [f]);
      expect((await pageOf(s, "limit=1")).items[0]?.note).toBe("dry");
      expect((await patch(s, f.id, { note: null })).status).toBe(200);
      expect((await pageOf(s, "limit=1")).items[0]?.note).toBeNull();
      expect((await patch(s, f.id, { note: "x".repeat(201) })).status).toBe(400);
      expect((await post(s, [{ ...feeding(catId, 2_000), note: "x".repeat(201) }])).status).toBe(400);
    });

    it("PATCH with amountMg alone is a 400 (the amount fields travel together)", async () => {
      const { s, catId } = await houseWithCat();
      const f = feeding(catId, 1_000);
      await post(s, [f]);
      expect((await patch(s, f.id, { amountMg: 5000 })).status).toBe(400);
    });
  });

  it("requires auth", async () => {
    const { s } = await houseWithCat();
    const r = await s.fetchAuthed("/api/feedings", { headers: { authorization: "Bearer nope" } });
    expect(r.status).toBe(401);
  });
});
