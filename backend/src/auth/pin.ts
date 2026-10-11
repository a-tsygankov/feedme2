/**
 * House PIN at rest: PBKDF2-SHA256, 100k iterations, 16-byte salt
 * (spec §3.2). A PIN is short, so the work factor is what stands between
 * a leaked table and every house.
 */
const ITERATIONS = 100_000;

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Null for anything that is not a non-empty, even-length hex string. */
function unhex(s: string): Uint8Array | null {
  if (s === "" || s.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(s)) return null;
  return new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
}

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  return hex(bits);
}

export async function hashPin(pin: string): Promise<{ salt: string; hash: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: hex(salt), hash: await derive(pin, salt) };
}

export async function verifyPin(pin: string, salt: string, hash: string): Promise<boolean> {
  // A pinless house stores "" / "" (test-login). Never derive from an
  // empty salt, and never throw on a damaged row: just say no.
  const saltBytes = unhex(salt);
  if (!saltBytes || hash === "") return false;
  const candidate = await derive(pin, saltBytes);
  // Constant-time compare: both are 64 hex chars.
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
