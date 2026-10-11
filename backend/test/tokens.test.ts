import { describe, expect, it } from "vitest";
import { ACCESS_TTL_SEC, hashToken, mintRefreshToken, signAccessToken, verifyAccessToken } from "../src/auth/tokens.ts";

const SECRET = "integration-test-secret";

describe("tokens", () => {
  it("round-trips a house id through the access token", async () => {
    const token = await signAccessToken("house-1", SECRET);
    expect(await verifyAccessToken(token, SECRET)).toEqual({ houseId: "house-1" });
  });
  it("rejects a tampered or wrong-secret token", async () => {
    const token = await signAccessToken("house-1", SECRET);
    expect(await verifyAccessToken(token + "x", SECRET)).toBeNull();
    expect(await verifyAccessToken(token, "other")).toBeNull();
  });
  it("expires after ACCESS_TTL_SEC", async () => {
    const issuedAt = Date.now() - (ACCESS_TTL_SEC + 5) * 1000;
    const token = await signAccessToken("house-1", SECRET, issuedAt);
    expect(await verifyAccessToken(token, SECRET)).toBeNull();
  });
  it("mints unguessable refresh tokens and hashes them deterministically", async () => {
    const t = mintRefreshToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mintRefreshToken()).not.toBe(t);
    expect(await hashToken(t)).toBe(await hashToken(t));
    expect(await hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});
