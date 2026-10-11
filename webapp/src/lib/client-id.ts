import { safeStorage } from "./safe-storage.ts";

/** Opaque per-install id (spec Q4 default): lets the console and the
 * feeding history say "logged from this phone" with no person identity. */
const KEY = "feedme2:clientId";

// Held only while storage refuses writes, so the id is at least stable for
// the session instead of changing on every call.
let sessionId: string | null = null;

function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID needs a secure context; plain-http LAN dev and older webviews lack it.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function getClientId(storage?: Pick<Storage, "getItem" | "setItem">): string {
  try {
    const s = storage ?? safeStorage();
    const existing = s.getItem(KEY);
    if (existing) return existing;
    const id = sessionId ?? newId();
    try {
      s.setItem(KEY, id);
      sessionId = null;
    } catch {
      sessionId = id;
    }
    return id;
  } catch {
    return sessionId ?? "ephemeral";
  }
}
