import { SELF, env } from "cloudflare:test";
import { DebugLogsResponseSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";

describe("GET /api/debug/logs", () => {
  beforeAll(applyAllMigrations);

  it("needs a house token", async () => {
    expect((await SELF.fetch("http://feedme2/api/debug/logs")).status).toBe(401);
  });

  it("returns this house's persisted entries newest first and never logs itself", async () => {
    const s = await signup();
    await s.fetchAuthed("/api/version");
    await s.fetchAuthed("/api/debug/logs");
    const { entries } = DebugLogsResponseSchema.parse(await (await s.fetchAuthed("/api/debug/logs?limit=50")).json());
    expect(entries.length).toBeGreaterThan(0);
    for (let i = 1; i < entries.length; i++) expect(entries[i - 1]!.ts).toBeGreaterThanOrEqual(entries[i]!.ts);
    expect(entries.some((e) => (e.data as { path?: string } | undefined)?.path?.startsWith("/api/debug"))).toBe(false);
    expect(entries.some((e) => (e.data as { path?: string } | undefined)?.path === "/api/version")).toBe(true);
  });

  it("rejects a limit above 500", async () => {
    const s = await signup();
    expect((await s.fetchAuthed("/api/debug/logs?limit=5000")).status).toBe(400);
  });

  it("filters by device id, scoped to this house", async () => {
    const s = await signup();
    const other = await signup();
    const ins = env.DB.prepare(
      "INSERT INTO log_entries (id, house_id, source, device_id, ts, level, msg, created_at) VALUES (?, ?, 'device', ?, ?, 'info', ?, ?)",
    );
    const now = Date.now();
    // No device upload route exists yet (Phase 2): seed rows directly.
    await env.DB.batch([
      ins.bind(crypto.randomUUID(), s.houseId, "dev-a", 100, "from a", now),
      ins.bind(crypto.randomUUID(), s.houseId, "dev-b", 200, "from b", now),
      ins.bind(crypto.randomUUID(), other.houseId, "dev-a", 300, "other house, same device id", now),
    ]);
    const get = async (qs: string) =>
      DebugLogsResponseSchema.parse(await (await s.fetchAuthed(`/api/debug/logs${qs}`)).json()).entries.map((e) => e.msg);
    expect(await get("?device=dev-a")).toEqual(["from a"]);
    expect(await get("?device=dev-b")).toEqual(["from b"]);
    expect(await get("?source=device")).toEqual(["from b", "from a"]);
    expect(await get("?device=nope")).toEqual([]);
  });
});
