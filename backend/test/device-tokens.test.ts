import { sign } from "hono/jwt";
import { describe, expect, it } from "vitest";
import { signAccessToken } from "../src/auth/tokens.ts";
import { DEVICE_TTL_SEC, signDeviceToken, verifyDeviceToken } from "../src/auth/device-tokens.ts";

const SECRET = "integration-test-secret-0123456789abcdef";
const DEV = "0123456789abcdef0123456789abcdef";
const JTI = "11111111-2222-4333-8444-555555555555";

describe("device tokens", () => {
  it("round-trips house, device and token ids and lives 365 days", async () => {
    // Signed "now": a fixed past instant would already be 365 days old and verify as expired.
    const t = await signDeviceToken("house-1", DEV, JTI, SECRET, Date.now());
    expect(await verifyDeviceToken(t, SECRET)).toEqual({ houseId: "house-1", deviceId: DEV, tokenId: JTI });
    const [, payload] = t.split(".");
    const claims = JSON.parse(atob(payload!.replace(/-/g, "+").replace(/_/g, "/")));
    expect(claims.exp - claims.iat).toBe(DEVICE_TTL_SEC + 5); // iat is backdated 5 s like access tokens
    expect(claims.typ).toBe("device");
    expect(claims.jti).toBe(JTI);
  });
  it("rejects a house access token, a tampered token and the wrong secret", async () => {
    const access = await signAccessToken("house-1", SECRET);
    expect(await verifyDeviceToken(access, SECRET)).toBeNull();
    const t = await signDeviceToken("house-1", DEV, JTI, SECRET);
    expect(await verifyDeviceToken(t + "x", SECRET)).toBeNull();
    expect(await verifyDeviceToken(t, "another-secret-that-is-long-enough-0000")).toBeNull();
  });
  it("rejects an expired device token", async () => {
    const t = await signDeviceToken("house-1", DEV, JTI, SECRET, Date.now() - (DEVICE_TTL_SEC + 60) * 1000);
    expect(await verifyDeviceToken(t, SECRET)).toBeNull();
  });
  // A token without a jti cannot be tied to one pairing, so it must never verify.
  it("rejects a validly signed device token that has no string jti", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const base = { typ: "device", sub: "house-1", did: DEV, iat: nowSec - 5, exp: nowSec + 1000 };
    expect(await verifyDeviceToken(await sign(base, SECRET, "HS256"), SECRET)).toBeNull();
    expect(await verifyDeviceToken(await sign({ ...base, jti: 7 }, SECRET, "HS256"), SECRET)).toBeNull();
    expect(await verifyDeviceToken(await sign({ ...base, jti: JTI }, SECRET, "HS256"), SECRET)).not.toBeNull();
  });
});
