/**
 * Device tokens (spec §3.2): a 365-day HS256 JWT issued once at pairing.
 * Same key as house access tokens, kept apart by `typ`; revocation is
 * the devices.revoked_at column, checked by requireDevice on every call.
 * `jti` is the pairing's token id (devices.token_id): only the token of the
 * latest pairing matches the row, so re-pairing kills every earlier token.
 */
import { sign, verify } from "hono/jwt";

export const DEVICE_TTL_SEC = 365 * 24 * 60 * 60;
/** Backdated like access tokens so a token is never "from the future" on another isolate. */
const IAT_SKEW_SEC = 5;
const MIN_SECRET_LENGTH = 32;

export async function signDeviceToken(houseId: string, deviceId: string, tokenId: string, secret: string, nowMs: number = Date.now()): Promise<string> {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("AUTH_SECRET must be at least 32 characters");
  const nowSec = Math.floor(nowMs / 1000);
  return sign({ typ: "device", sub: houseId, did: deviceId, jti: tokenId, iat: nowSec - IAT_SKEW_SEC, exp: nowSec + DEVICE_TTL_SEC }, secret, "HS256");
}

export async function verifyDeviceToken(token: string, secret: string): Promise<{ houseId: string; deviceId: string; tokenId: string } | null> {
  try {
    // Algorithm pinned: never let the token choose (alg=none confusion).
    const p = await verify(token, secret, "HS256");
    if (p["typ"] !== "device" || typeof p["sub"] !== "string" || typeof p["did"] !== "string" || typeof p["jti"] !== "string") return null;
    return { houseId: p["sub"], deviceId: p["did"], tokenId: p["jti"] };
  } catch {
    return null;
  }
}
