/**
 * localStorage that can never throw at import time. Safari private mode,
 * blocked site data and some embedded webviews throw on the property
 * access itself (SecurityError), and a module-level `localStorage` read in
 * the auth store would then white-screen the whole app before React mounts.
 * The in-memory fallback keeps the session working; it just forgets on reload.
 */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// One shared fallback so every caller in a session sees the same data.
const fallback = new Map<string, string>();
const memoryStorage: KeyValueStorage = {
  getItem: (k) => fallback.get(k) ?? null,
  setItem: (k, v) => void fallback.set(k, String(v)),
  removeItem: (k) => void fallback.delete(k),
};

export function safeStorage(): KeyValueStorage {
  try {
    const ls = globalThis.localStorage;
    // Some browsers hand back the object and only throw on first use.
    ls.getItem("feedme2:probe");
    return ls;
  } catch {
    return memoryStorage;
  }
}
