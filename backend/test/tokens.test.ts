import { sign, verify } from "hono/jwt";
import { describe, expect, it } from "vitest";
import { ACCESS_TTL_SEC, hashToken, mintRefreshToken, signAccessToken, verifyAccessToken } from "../src/auth/tokens.ts";

const SECRET = "integration-test-secret-0123456789abcdef";

describe("tokens", () => {
  it("round-trips a house id through the access token", async () => {
    const token = await signAccessToken("house-1", SECRET);
    expect(await verifyAccessToken(token, SECRET)).toEqual({ houseId: "house-1" });
  });
  it("rejects a tampered or wrong-secret token", async () => {
    const token = await signAccessToken("house-1", SECRET);
    expect(await verifyAccessToken(token + "x", SECRET)).toBeNull();
    expect(await verifyAccessToken(token, "other-other-other-other-other-other-other")).toBeNull();
  });
  it("expires after ACCESS_TTL_SEC", async () => {
    const issuedAt = Date.now() - (ACCESS_TTL_SEC + 5) * 1000;
    const token = await signAccessToken("house-1", SECRET, issuedAt);
    expect(await verifyAccessToken(token, SECRET)).toBeNull();
  });
  it("backdates iat by 5 s but keeps the full 15-minute lifetime", async () => {
    const now = Date.now();
    const token = await signAccessToken("house-1", SECRET, now);
    const p = await verify(token, SECRET, "HS256");
    expect(p["iat"]).toBe(Math.floor(now / 1000) - 5);
    expect(p["exp"]).toBe(Math.floor(now / 1000) + ACCESS_TTL_SEC);
    expect(p["typ"]).toBe("access");
  });
  it("rejects a validly signed token that lacks typ=access", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const noTyp = await sign({ sub: "house-1", iat, exp: iat + 60 }, SECRET, "HS256");
    expect(await verifyAccessToken(noTyp, SECRET)).toBeNull();
    const wrongTyp = await sign({ sub: "house-1", typ: "device", iat, exp: iat + 60 }, SECRET, "HS256");
    expect(await verifyAccessToken(wrongTyp, SECRET)).toBeNull();
  });
  it("refuses to sign with a secret shorter than 32 characters", async () => {
    await expect(signAccessToken("house-1", "short")).rejects.toThrow(/secret/i);
    await expect(signAccessToken("house-1", "x".repeat(31))).rejects.toThrow(/secret/i);
    await expect(signAccessToken("house-1", "x".repeat(32))).resolves.toBeTypeOf("string");
  });
  it("mints unguessable refresh tokens and hashes them deterministically", async () => {
    const t = mintRefreshToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mintRefreshToken()).not.toBe(t);
    expect(await hashToken(t)).toBe(await hashToken(t));
    expect(await hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});
