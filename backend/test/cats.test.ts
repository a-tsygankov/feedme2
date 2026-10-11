import { SELF } from "cloudflare:test";
import { CatSchema, MAX_CATS } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";

const id = () => crypto.randomUUID();

describe("/api/cats", () => {
  beforeAll(applyAllMigrations);

  it("creates with defaults from the house, lists in sort order, idempotent on id", async () => {
    const s = await signup();
    const catId = id();
    const r1 = await s.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: catId, name: "Mochi" }) });
    expect(r1.status).toBe(201);
    const cat = CatSchema.parse(((await r1.json()) as { cat: unknown }).cat);
    expect(cat.hungryAfterSec).toBe(18000);
    expect(cat.avatarPose).toBe("C2");
    expect(cat.lastFedAt).toBeNull();
    const r2 = await s.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: catId, name: "Mochi" }) });
    expect(r2.status).toBe(200);
    await s.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: id(), name: "Luna", color: "#2196F3" }) });
    const list = ((await (await s.fetchAuthed("/api/cats")).json()) as { cats: { name: string }[] }).cats;
    expect(list.map((c) => c.name)).toEqual(["Mochi", "Luna"]);
  });

  it("patches, soft-deletes, refuses to delete the last cat, and caps at MAX_CATS", async () => {
    const s = await signup();
    const a = id();
    const b = id();
    await s.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: a, name: "A" }) });
    await s.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: b, name: "B" }) });
    const p = await s.fetchAuthed(`/api/cats/${a}`, { method: "PATCH", body: JSON.stringify({ name: "Ace", avatarPose: "B1" }) });
    expect(p.status).toBe(200);
    expect(((await p.json()) as { cat: { name: string } }).cat.name).toBe("Ace");
    expect((await s.fetchAuthed(`/api/cats/${b}`, { method: "DELETE" })).status).toBe(204);
    expect((await s.fetchAuthed(`/api/cats/${a}`, { method: "DELETE" })).status).toBe(409);
    for (let i = 1; i < MAX_CATS; i++) {
      expect((await s.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: id(), name: `C${i}` }) })).status).toBe(201);
    }
    expect((await s.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: id(), name: "Too many" }) })).status).toBe(409);
  });

  it("is scoped to the house", async () => {
    const s1 = await signup();
    const s2 = await signup();
    const catId = id();
    await s1.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: catId, name: "Mine" }) });
    expect((await s2.fetchAuthed(`/api/cats/${catId}`, { method: "PATCH", body: JSON.stringify({ name: "Stolen" }) })).status).toBe(404);
    expect(((await (await s2.fetchAuthed("/api/cats")).json()) as { cats: unknown[] }).cats).toEqual([]);
  });

  const post = (s: Awaited<ReturnType<typeof signup>>, body: unknown) =>
    s.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify(body) });
  type CatJson = { id: string; name: string; sortOrder: number; hungryAfterSec: number; modifiedAt: number };
  const listCats = async (s: Awaited<ReturnType<typeof signup>>) =>
    ((await (await s.fetchAuthed("/api/cats")).json()) as { cats: CatJson[] }).cats;

  it("requires authentication", async () => {
    await signup();
    expect((await SELF.fetch("http://feedme2/api/cats")).status).toBe(401);
    expect((await SELF.fetch("http://feedme2/api/cats", { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("cross-house DELETE is a 404 and the cat survives", async () => {
    const s1 = await signup();
    const s2 = await signup();
    const a = id();
    await post(s1, { id: a, name: "Mine" });
    await post(s1, { id: id(), name: "Other" });
    await post(s2, { id: id(), name: "Theirs" });
    await post(s2, { id: id(), name: "Theirs2" });
    expect((await s2.fetchAuthed(`/api/cats/${a}`, { method: "DELETE" })).status).toBe(404);
    expect((await listCats(s1)).map((c) => c.id)).toContain(a);
  });

  it("POST of another house's cat id is a 404 that leaks nothing", async () => {
    const s1 = await signup();
    const s2 = await signup();
    const a = id();
    await post(s1, { id: a, name: "Mine" });
    const r = await post(s2, { id: a, name: "Hijack" });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not found" });
    expect(await listCats(s2)).toEqual([]);
    expect((await listCats(s1))[0]?.name).toBe("Mine");
  });

  it("re-POST of a soft-deleted own id is 410, and DELETE of it again is an idempotent 204", async () => {
    const s = await signup();
    const a = id();
    await post(s, { id: id(), name: "Keeper" });
    await post(s, { id: a, name: "Gone" });
    expect((await s.fetchAuthed(`/api/cats/${a}`, { method: "DELETE" })).status).toBe(204);
    const again = await post(s, { id: a, name: "Gone" });
    expect(again.status).toBe(410);
    expect(await again.json()).toEqual({ error: "cat_deleted" });
    expect((await s.fetchAuthed(`/api/cats/${a}`, { method: "DELETE" })).status).toBe(204);
    expect((await listCats(s)).map((c) => c.id)).not.toContain(a);
  });

  it("a deleted cat is absent from GET and PATCH on it is a 404", async () => {
    const s = await signup();
    const a = id();
    await post(s, { id: id(), name: "Keeper" });
    await post(s, { id: a, name: "Gone" });
    await s.fetchAuthed(`/api/cats/${a}`, { method: "DELETE" });
    expect((await listCats(s)).map((c) => c.id)).not.toContain(a);
    expect((await s.fetchAuthed(`/api/cats/${a}`, { method: "PATCH", body: JSON.stringify({ name: "Zombie" }) })).status).toBe(404);
  });

  it("DELETE of an unknown id is a 404", async () => {
    const s = await signup();
    await post(s, { id: id(), name: "Only" });
    expect((await s.fetchAuthed(`/api/cats/${id()}`, { method: "DELETE" })).status).toBe(404);
  });

  it("an empty PATCH is a 400 invalid_request", async () => {
    const s = await signup();
    const a = id();
    await post(s, { id: a, name: "A" });
    const r = await s.fetchAuthed(`/api/cats/${a}`, { method: "PATCH", body: "{}" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe("invalid_request");
  });

  it("PATCH bumps modifiedAt", async () => {
    const s = await signup();
    const a = id();
    const created = (await (await post(s, { id: a, name: "A" })).json()) as { cat: CatJson };
    await new Promise((r) => setTimeout(r, 5));
    const patched = (await (await s.fetchAuthed(`/api/cats/${a}`, { method: "PATCH", body: JSON.stringify({ name: "B" }) })).json()) as { cat: CatJson };
    expect(patched.cat.modifiedAt).toBeGreaterThan(created.cat.modifiedAt);
  });

  it("a new cat after deleting the middle one gets max sortOrder + 1 (no collision)", async () => {
    const s = await signup();
    const [a, b, c] = [id(), id(), id()];
    await post(s, { id: a, name: "A" });
    await post(s, { id: b, name: "B" });
    await post(s, { id: c, name: "C" });
    await s.fetchAuthed(`/api/cats/${b}`, { method: "DELETE" });
    const r = (await (await post(s, { id: id(), name: "D" })).json()) as { cat: CatJson };
    expect(r.cat.sortOrder).toBe(3);
    const cats = await listCats(s);
    expect(new Set(cats.map((x) => x.sortOrder)).size).toBe(cats.length);
    expect(cats.map((x) => x.name)).toEqual(["A", "C", "D"]);
  });

  it("hungryAfterSec comes from the house default, and an explicit value wins", async () => {
    const s = await signup();
    expect((await s.fetchAuthed("/api/house", { method: "PATCH", body: JSON.stringify({ hungryAfterSecDefault: 7200 }) })).status).toBe(200);
    const fromHouse = (await (await post(s, { id: id(), name: "Inherits" })).json()) as { cat: CatJson };
    expect(fromHouse.cat.hungryAfterSec).toBe(7200);
    const explicit = (await (await post(s, { id: id(), name: "Explicit", hungryAfterSec: 3600 })).json()) as { cat: CatJson };
    expect(explicit.cat.hungryAfterSec).toBe(3600);
  });

  it("re-POST of the same id with a different body is first-write-wins (200, original kept)", async () => {
    const s = await signup();
    const a = id();
    await post(s, { id: a, name: "First" });
    const r = await post(s, { id: a, name: "Second" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { cat: CatJson }).cat.name).toBe("First");
  });

  it("concurrent creates never exceed MAX_CATS or collide on sortOrder", async () => {
    const s = await signup();
    const results = await Promise.all(Array.from({ length: MAX_CATS + 4 }, (_, i) => post(s, { id: id(), name: `P${i}` })));
    expect(results.filter((r) => r.status === 201).length).toBe(MAX_CATS);
    expect(results.filter((r) => r.status === 409).length).toBe(4);
    const orders = (await listCats(s)).map((x) => x.sortOrder);
    expect(orders.length).toBe(MAX_CATS);
    expect(new Set(orders).size).toBe(MAX_CATS);
  });
});
