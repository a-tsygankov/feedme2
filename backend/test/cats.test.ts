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
});
