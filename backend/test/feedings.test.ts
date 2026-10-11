import { CatSchema, FeedingsPageSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
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

type CatRow = { id: string; lastFedAt: number | null; defaultAmountMg: number | null };
async function listCats(s: Session) {
  return ((await (await s.fetchAuthed("/api/cats")).json()) as { cats: CatRow[] }).cats;
}

const post = (s: Session, items: unknown[]) => s.fetchAuthed("/api/feedings", { method: "POST", body: JSON.stringify(items) });
const pageOf = async (s: Session, qs: string) => FeedingsPageSchema.parse(await (await s.fetchAuthed(`/api/feedings?${qs}`)).json());

describe("/api/feedings", () => {
  beforeAll(applyAllMigrations);

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
    expect((await s.fetchAuthed(`/api/feedings/${f.id}`, { method: "DELETE" })).status).toBe(404);
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
    expect(await r.json()).toEqual({ error: "cat_not_found" });
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
    expect(await r.json()).toEqual({ error: "cat_not_found" });
    expect((await s2.fetchAuthed(`/api/feedings/${f.id}`, { method: "PATCH", body: JSON.stringify({ note: "x" }) })).status).toBe(404);
    expect((await s2.fetchAuthed(`/api/feedings/${f.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("requires auth", async () => {
    const { s } = await houseWithCat();
    const r = await s.fetchAuthed("/api/feedings", { headers: { authorization: "Bearer nope" } });
    expect(r.status).toBe(401);
  });
});
