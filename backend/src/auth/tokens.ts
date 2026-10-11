/**
 * House session tokens (spec §3.2): a short-lived HS256 JWT the client
 * keeps in memory, and an opaque refresh token the client persists.
 * The refresh token is stored only as its SHA-256.
 */
import { sign, verify } from "hono/jwt";

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** HS256 with a short key is brute-forceable offline; 32 chars is the floor. */
const MIN_SECRET_LENGTH = 32;
/**
 * `iat` is backdated so a token minted by one isolate is never "from the
 * future" to another isolate whose clock runs a little behind.
 */
const IAT_SKEW_SEC = 5;

/**
 * The route layer's wall clock. Indirected through an object so tests
 * can move time (replay grace windows) without touching `Date`.
 */
export const clock = { now: (): number => Date.now() };

export async function signAccessToken(houseId: string, secret: string, nowMs: number = Date.now()): Promise<string> {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("AUTH_SECRET must be at least 32 characters");
  const nowSec = Math.floor(nowMs / 1000);
  // `typ` keeps other token kinds (device tokens, spec §3.2) from being
  // accepted here even though they may share the signing key.
  return sign({ sub: houseId, typ: "access", iat: nowSec - IAT_SKEW_SEC, exp: nowSec + ACCESS_TTL_SEC }, secret, "HS256");
}

export async function verifyAccessToken(token: string, secret: string): Promise<{ houseId: string } | null> {
  try {
    // Algorithm pinned: never let the token choose (alg=none confusion).
    const payload = await verify(token, secret, "HS256");
    if (payload["typ"] !== "access") return null;
    return typeof payload["sub"] === "string" ? { houseId: payload["sub"] } : null;
  } catch {
    return null;
  }
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function mintRefreshToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
