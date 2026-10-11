import { env, SELF } from "cloudflare:test";
import { TokensResponseSchema } from "@feedme2/shared";
import { sign } from "hono/jwt";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyPin } from "../src/auth/pin.ts";
import { clock, hashToken, signAccessToken } from "../src/auth/tokens.ts";
import { db } from "../src/db/client.ts";
import { refreshTokens } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { app } from "../src/index.ts";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";

// Spy on the real pin verifier while keeping its behaviour: M4 asserts
// login runs it for every request, known house or not.
vi.mock("../src/auth/pin.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/auth/pin.ts")>();
  return { ...orig, verifyPin: vi.fn(orig.verifyPin) };
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch(`http://feedme2${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

/** Same app, explicit bindings: lets a test flip ENVIRONMENT. */
const postApp = (path: string, body: unknown, bindings: Record<string, unknown> = {}) =>
  app.fetch(
    new Request(`http://feedme2${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { ...env, ...bindings },
  );

const tokensOf = async (res: Response) => TokensResponseSchema.parse(await res.json());

describe("auth", () => {
  beforeAll(applyAllMigrations);
  afterEach(() => {
    vi.mocked(verifyPin).mockClear();
    vi.restoreAllMocks();
  });

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

  it("house names are compared after NFKC, so NFC and NFD spellings are one house", async () => {
    const tag = Date.now();
    await signup(`Café ${tag}`, "4321");
    const dup = await post("/api/auth/setup", { houseName: `Café ${tag}`, pin: "9999" });
    expect(dup.status).toBe(409);
    // Inner whitespace runs collapse too.
    const spaced = await post("/api/auth/setup", { houseName: `Café   ${tag}`, pin: "9999" });
    expect(spaced.status).toBe(409);
    const login = await post("/api/auth/login", { houseName: `Café ${tag}`, pin: "4321" });
    expect(login.status).toBe(200);
    expect((await tokensOf(login)).house.name).toBe(`Café ${tag}`);
  });

  it("setup rejects a bad body with a structured 400", async () => {
    const res = await post("/api/auth/setup", { houseName: "x", pin: "abc" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: Array<{ path: unknown[]; message: string }> };
    expect(body.error).toBe("invalid_request");
    expect(body.issues.map((i) => i.path[0]).sort()).toEqual(["houseName", "pin"]);
    expect(typeof body.issues[0]!.message).toBe("string");
  });

  it("login with a wrong pin or unknown house is a uniform 401", async () => {
    await signup("Pin House", "1111");
    const wrong = await post("/api/auth/login", { houseName: "Pin House", pin: "2222" });
    const unknown = await post("/api/auth/login", { houseName: "Nobody", pin: "1111" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.text()).toBe(await unknown.text());
  });

  it("login runs the pin hash for an unknown house and for a pinless one (uniform cost)", async () => {
    // singleWorker shares one module cache across test files: when another
    // file (a slower feedings suite, say) already loaded the app, the
    // file-level vi.mock never reached it and the spy saw 0 calls. A fresh
    // graph imported after resetModules always gets the mock.
    vi.resetModules();
    const { app: freshApp } = await import("../src/index.ts");
    const { verifyPin: freshVerify } = await import("../src/auth/pin.ts");
    const spy = vi.mocked(freshVerify);
    const login = (houseName: string) =>
      freshApp.fetch(
        new Request("http://feedme2/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ houseName, pin: "1111" }) }),
        env,
      );
    spy.mockClear();
    expect((await login("Nobody At All")).status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);

    await post("/api/auth/test-login", { houseName: "Pinless Login" });
    spy.mockClear();
    expect((await login("Pinless Login")).status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("refresh rotates the token; replaying it long after kills the chain", async () => {
    const s = await signup();
    const t0 = Date.now();
    const now = vi.spyOn(clock, "now");
    now.mockReturnValue(t0 + 1_000);
    const r1 = await postApp("/api/auth/refresh", { refreshToken: s.refresh });
    expect(r1.status).toBe(200);
    const t1 = await tokensOf(r1);
    expect(t1.refreshToken).not.toBe(s.refresh);

    now.mockReturnValue(t0 + 121_000);
    const replay = await postApp("/api/auth/refresh", { refreshToken: s.refresh });
    expect(replay.status).toBe(401);
    expect((await postApp("/api/auth/refresh", { refreshToken: t1.refreshToken })).status).toBe(401);
  });

  it("a replay within the grace window mints a fresh child and revokes nothing", async () => {
    const s = await signup();
    const t0 = Date.now();
    const now = vi.spyOn(clock, "now");
    now.mockReturnValue(t0 + 1_000);
    const first = await tokensOf(await postApp("/api/auth/refresh", { refreshToken: s.refresh }));

    // The response was lost / a second tab raced: same token, 5 s later.
    now.mockReturnValue(t0 + 6_000);
    const again = await postApp("/api/auth/refresh", { refreshToken: s.refresh });
    expect(again.status).toBe(200);
    const second = await tokensOf(again);
    expect(second.refreshToken).not.toBe(first.refreshToken);

    // Both children chain to the presented token, so the family stays traceable.
    const rowOf = async (token: string) =>
      (await db(env.DB).select().from(refreshTokens).where(eq(refreshTokens.tokenHash, await hashToken(token))))[0]!;
    const parent = await rowOf(s.refresh);
    expect((await rowOf(first.refreshToken)).rotatedFrom).toBe(parent.id);
    expect((await rowOf(second.refreshToken)).rotatedFrom).toBe(parent.id);

    now.mockReturnValue(t0 + 7_000);
    expect((await postApp("/api/auth/refresh", { refreshToken: first.refreshToken })).status).toBe(200);
    expect((await postApp("/api/auth/refresh", { refreshToken: second.refreshToken })).status).toBe(200);
  });

  it("an unknown or expired refresh token is a 401", async () => {
    const s = await signup();
    expect((await post("/api/auth/refresh", { refreshToken: "x".repeat(43) })).status).toBe(401);
    vi.spyOn(clock, "now").mockReturnValue(Date.now() + 31 * 24 * 3_600_000);
    expect((await postApp("/api/auth/refresh", { refreshToken: s.refresh })).status).toBe(401);
  });

  it("logout revokes the presented refresh token only", async () => {
    const s = await signup("Two Phones", "1234");
    const other = await tokensOf(await post("/api/auth/login", { houseName: "Two Phones", pin: "1234" }));
    const out = await s.fetchAuthed("/api/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: s.refresh }) });
    expect(out.status).toBe(204);
    expect((await post("/api/auth/refresh", { refreshToken: s.refresh })).status).toBe(401);
    expect((await post("/api/auth/refresh", { refreshToken: other.refreshToken })).status).toBe(200);
  });

  it("logout cannot revoke another house's refresh token", async () => {
    const a = await signup();
    const b = await signup();
    const out = await a.fetchAuthed("/api/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: b.refresh }) });
    expect(out.status).toBe(204);
    expect((await post("/api/auth/refresh", { refreshToken: b.refresh })).status).toBe(200);
  });

  it("pin change needs the current pin, kills other sessions and returns fresh tokens", async () => {
    const s = await signup("Change Pin", "1234");
    const bad = await s.fetchAuthed("/api/auth/pin", { method: "PATCH", body: JSON.stringify({ currentPin: "0000", newPin: "5678" }) });
    // 403, not 401: the webapp treats every 401 as an expired session and signs out.
    expect(bad.status).toBe(403);
    expect(await bad.json()).toEqual({ error: "wrong_pin" });
    // A missing/invalid bearer is still 401.
    expect((await SELF.fetch("http://feedme2/api/auth/pin", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPin: "1234", newPin: "5678" }) })).status).toBe(401);
    const ok = await s.fetchAuthed("/api/auth/pin", { method: "PATCH", body: JSON.stringify({ currentPin: "1234", newPin: "5678" }) });
    expect(ok.status).toBe(200);
    const fresh = await tokensOf(ok);
    expect((await post("/api/auth/login", { houseName: "Change Pin", pin: "5678" })).status).toBe(200);
    expect((await post("/api/auth/login", { houseName: "Change Pin", pin: "1234" })).status).toBe(401);
    expect((await post("/api/auth/refresh", { refreshToken: s.refresh })).status).toBe(401);
    expect((await post("/api/auth/refresh", { refreshToken: fresh.refreshToken })).status).toBe(200);
  });

  it("a pinless (test-login) house can set its first pin without a current one", async () => {
    const t = await tokensOf(await post("/api/auth/test-login", { houseName: "Pinless Setter" }));
    const authed = { "content-type": "application/json", authorization: `Bearer ${t.accessToken}` };
    const res = await SELF.fetch("http://feedme2/api/auth/pin", {
      method: "PATCH", headers: authed, body: JSON.stringify({ currentPin: "0000", newPin: "5678" }),
    });
    expect(res.status).toBe(200);
    expect((await tokensOf(res)).house.id).toBe(t.house.id);
    expect((await post("/api/auth/login", { houseName: "Pinless Setter", pin: "5678" })).status).toBe(200);
    // From now on the pin is real: a wrong current pin is refused.
    const again = await SELF.fetch("http://feedme2/api/auth/pin", {
      method: "PATCH", headers: authed, body: JSON.stringify({ currentPin: "0000", newPin: "9999" }),
    });
    expect(again.status).toBe(403);
  });

  it("setup fails before inserting anything when the signing secret is weak", async () => {
    const name = `Weak Secret ${Date.now()}`;
    const res = await postApp("/api/auth/setup", { houseName: name, pin: "1234" }, { AUTH_SECRET: "short" });
    expect(res.status).toBe(500);
    // The name is still free: nothing was inserted.
    expect((await post("/api/auth/setup", { houseName: name, pin: "1234" })).status).toBe(201);
  });
});

describe("issueTokens ordering", () => {
  beforeAll(applyAllMigrations);

  it("a login that cannot sign leaves no refresh row behind", async () => {
    const s = await signup();
    const count = async () => (await db(env.DB).select().from(refreshTokens).where(eq(refreshTokens.houseId, s.houseId))).length;
    const before = await count();
    const res = await postApp("/api/auth/login", { houseName: s.name, pin: s.pin }, { AUTH_SECRET: "short" });
    expect(res.status).toBe(500);
    expect(await count()).toBe(before);
  });
});

describe("requireHouse", () => {
  beforeAll(applyAllMigrations);
  const me = (authorization?: string) =>
    SELF.fetch("http://feedme2/api/auth/me", { headers: authorization === undefined ? {} : { authorization } });
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  it("rejects missing, malformed and empty tokens uniformly", async () => {
    expect((await me()).status).toBe(401);
    expect((await me("Bearer nope")).status).toBe(401);
    expect((await me("Bearer ")).status).toBe(401);
    expect((await me("Basic abc")).status).toBe(401);
  });

  it("accepts the scheme case-insensitively", async () => {
    const s = await signup();
    expect((await me(`bearer ${s.access}`)).status).toBe(200);
    expect((await me(`BEARER ${s.access}`)).status).toBe(200);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const s = await signup();
    const forged = await signAccessToken(s.houseId, "a-different-secret-that-is-long-enough!!");
    expect((await me(`Bearer ${forged}`)).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const s = await signup();
    const old = await signAccessToken(s.houseId, env.AUTH_SECRET, Date.now() - 1000 * 1000);
    expect((await me(`Bearer ${old}`)).status).toBe(401);
  });

  it("rejects an alg=none token", async () => {
    const s = await signup();
    const iat = Math.floor(Date.now() / 1000);
    const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: s.houseId, typ: "access", iat, exp: iat + 900 })}.`;
    expect((await me(`Bearer ${none}`)).status).toBe(401);
  });

  it("rejects a validly signed token with no sub", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const t = await sign({ typ: "access", iat, exp: iat + 900 }, env.AUTH_SECRET, "HS256");
    expect((await me(`Bearer ${t}`)).status).toBe(401);
  });
});

describe("test-login", () => {
  beforeAll(applyAllMigrations);

  it("mints a house without a pin in development and is idempotent by name", async () => {
    const a = await post("/api/auth/test-login", { houseName: "E2E House" });
    const b = await post("/api/auth/test-login", { houseName: "E2E House" });
    expect(a.status).toBe(200);
    expect((await tokensOf(a)).house.id).toBe((await tokensOf(b)).house.id);
  });

  it("is enabled for ENVIRONMENT=test", async () => {
    expect((await postApp("/api/auth/test-login", { houseName: "Test Env House" }, { ENVIRONMENT: "test" })).status).toBe(200);
  });

  it("fails closed: production, unset and unknown environments get 404", async () => {
    for (const ENVIRONMENT of ["production", undefined, "", "staging", "prod"]) {
      const res = await postApp("/api/auth/test-login", { houseName: "Closed House" }, { ENVIRONMENT });
      expect(res.status, String(ENVIRONMENT)).toBe(404);
    }
    // Nothing was created by the refused calls.
    expect((await post("/api/auth/setup", { houseName: "Closed House", pin: "1234" })).status).toBe(201);
  });

  it("never signs into a house that has a pin", async () => {
    await signup("Has A Pin", "1234");
    const res = await post("/api/auth/test-login", { houseName: "has a pin" });
    expect(res.status).toBe(404);
  });
});
