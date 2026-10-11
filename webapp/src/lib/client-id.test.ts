// @vitest-environment jsdom
// getClientId keeps a module-level session memo, so each test loads a fresh copy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
async function load() {
  vi.resetModules();
  return (await import("./client-id.ts")).getClientId;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("getClientId", () => {
  it("generates once, persists, and returns the stored id afterwards", async () => {
    const getClientId = await load();
    const storage = memStorage();
    const id = getClientId(storage);
    expect(id).toMatch(UUID);
    expect(storage.getItem("feedme2:clientId")).toBe(id);
    expect(getClientId(storage)).toBe(id);
  });

  it("defaults to localStorage", async () => {
    const getClientId = await load();
    const id = getClientId();
    expect(localStorage.getItem("feedme2:clientId")).toBe(id);
  });

  it("builds a v4 uuid from getRandomValues when randomUUID is missing", async () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) });
    const getClientId = await load();
    expect(getClientId(memStorage())).toMatch(UUID);
  });

  it("stays stable for the session when storage cannot be written", async () => {
    const getClientId = await load();
    const broken = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    const first = getClientId(broken);
    expect(first).toMatch(UUID);
    expect(getClientId(broken)).toBe(first);
  });

  it("does not throw when the default storage is blocked", async () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } });
    try {
      const getClientId = await load();
      const id = getClientId();
      expect(id).toMatch(UUID);
      expect(getClientId()).toBe(id);
    } finally {
      if (orig) Object.defineProperty(globalThis, "localStorage", orig); else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});
