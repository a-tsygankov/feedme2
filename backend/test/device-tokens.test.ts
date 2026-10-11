import { describe, expect, it } from "vitest";
import { signAccessToken } from "../src/auth/tokens.ts";
import { DEVICE_TTL_SEC, signDeviceToken, verifyDeviceToken } from "../src/auth/device-tokens.ts";

const SECRET = "integration-test-secret-0123456789abcdef";
const DEV = "0123456789abcdef0123456789abcdef";

describe("device tokens", () => {
  it("round-trips house and device ids and lives 365 days", async () => {
    // Signed "now": a fixed past instant would already be 365 days old and verify as expired.
    const t = await signDeviceToken("house-1", DEV, SECRET, Date.now());
    expect(await verifyDeviceToken(t, SECRET)).toEqual({ houseId: "house-1", deviceId: DEV });
    const [, payload] = t.split(".");
    const claims = JSON.parse(atob(payload!.replace(/-/g, "+").replace(/_/g, "/")));
    expect(claims.exp - claims.iat).toBe(DEVICE_TTL_SEC + 5); // iat is backdated 5 s like access tokens
    expect(claims.typ).toBe("device");
  });
  it("rejects a house access token, a tampered token and the wrong secret", async () => {
    const access = await signAccessToken("house-1", SECRET);
    expect(await verifyDeviceToken(access, SECRET)).toBeNull();
    const t = await signDeviceToken("house-1", DEV, SECRET);
    expect(await verifyDeviceToken(t + "x", SECRET)).toBeNull();
    expect(await verifyDeviceToken(t, "another-secret-that-is-long-enough-0000")).toBeNull();
  });
  it("rejects an expired device token", async () => {
    const t = await signDeviceToken("house-1", DEV, SECRET, Date.now() - (DEVICE_TTL_SEC + 60) * 1000);
    expect(await verifyDeviceToken(t, SECRET)).toBeNull();
  });
});
