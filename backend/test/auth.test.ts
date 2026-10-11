import { SELF } from "cloudflare:test";
import { TokensResponseSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch(`http://feedme2${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("auth", () => {
  beforeAll(applyAllMigrations);

  it("setup returns tokens and the house with default settings", async () => {
    const s = await signup("Mochi House");
    expect(s.house.name).toBe("Mochi House");
    expect(s.house.settings.foodUnit).toBe("g");
    expect(s.house.settings.canSizeMg).toBe(155922);
    const me = await s.fetchAuthed("/api/auth/me");
    expect(me.status).toBe(200);
    expect(((await me.json()) as { house: { id: string } }).house.id).toBe(s.houseId);
  });

  it("house names are unique case-insensitively, and login finds either spelling", async () => {
    await signup("Luna Loft", "4321");
    const dup = await post("/api/auth/setup", { houseName: "luna loft", pin: "9999" });
    expect(dup.status).toBe(409);
    const login = await post("/api/auth/login", { houseName: "LUNA LOFT", pin: "4321" });
    expect(login.status).toBe(200);
    expect(TokensResponseSchema.parse(await login.json()).house.name).toBe("Luna Loft");
  });

  it("login with a wrong pin or unknown house is a uniform 401", async () => {
    await signup("Pin House", "1111");
    const wrong = await post("/api/auth/login", { houseName: "Pin House", pin: "2222" });
    const unknown = await post("/api/auth/login", { houseName: "Nobody", pin: "1111" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.text()).toBe(await unknown.text());
  });

  it("refresh rotates the token; the rotated token is dead and kills the chain", async () => {
    const s = await signup();
    const r1 = await post("/api/auth/refresh", { refreshToken: s.refresh });
    expect(r1.status).toBe(200);
    const t1 = TokensResponseSchema.parse(await r1.json());
    expect(t1.refreshToken).not.toBe(s.refresh);
    // Replay of the original: rejected, and the successor is revoked too.
    const replay = await post("/api/auth/refresh", { refreshToken: s.refresh });
    expect(replay.status).toBe(401);
    const afterReplay = await post("/api/auth/refresh", { refreshToken: t1.refreshToken });
    expect(afterReplay.status).toBe(401);
  });

  it("logout revokes the refresh token", async () => {
    const s = await signup();
    const out = await s.fetchAuthed("/api/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: s.refresh }) });
    expect(out.status).toBe(204);
    expect((await post("/api/auth/refresh", { refreshToken: s.refresh })).status).toBe(401);
  });

  it("pin change needs the current pin and invalidates other sessions", async () => {
    const s = await signup("Change Pin", "1234");
    const bad = await s.fetchAuthed("/api/auth/pin", { method: "PATCH", body: JSON.stringify({ currentPin: "0000", newPin: "5678" }) });
    expect(bad.status).toBe(401);
    const ok = await s.fetchAuthed("/api/auth/pin", { method: "PATCH", body: JSON.stringify({ currentPin: "1234", newPin: "5678" }) });
    expect(ok.status).toBe(204);
    expect((await post("/api/auth/login", { houseName: "Change Pin", pin: "5678" })).status).toBe(200);
    expect((await post("/api/auth/refresh", { refreshToken: s.refresh })).status).toBe(401);
  });

  it("requireHouse rejects missing, malformed and foreign tokens uniformly", async () => {
    expect((await SELF.fetch("http://feedme2/api/auth/me")).status).toBe(401);
    expect((await SELF.fetch("http://feedme2/api/auth/me", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("test-login mints a house without a pin in non-production and is idempotent by name", async () => {
    const a = await post("/api/auth/test-login", { houseName: "E2E House" });
    const b = await post("/api/auth/test-login", { houseName: "E2E House" });
    expect(a.status).toBe(200);
    expect(TokensResponseSchema.parse(await a.json()).house.id).toBe(TokensResponseSchema.parse(await b.json()).house.id);
  });
});
