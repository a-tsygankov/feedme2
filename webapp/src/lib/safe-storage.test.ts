// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeStorage } from "./safe-storage.ts";

afterEach(() => { vi.unstubAllGlobals(); });

describe("safeStorage", () => {
  it("returns localStorage when it works", () => {
    expect(safeStorage()).toBe(localStorage);
  });

  it("falls back to a working in-memory store when touching localStorage throws", () => {
    // Safari private mode / blocked site data throws on the property access itself.
    const orig = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } });
    try {
      const s = safeStorage();
      expect(s.getItem("k")).toBeNull();
      s.setItem("k", "v");
      expect(s.getItem("k")).toBe("v");
      s.removeItem("k");
      expect(s.getItem("k")).toBeNull();
    } finally {
      if (orig) Object.defineProperty(globalThis, "localStorage", orig); else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("falls back when getItem throws", () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("nope"); }, setItem() {}, removeItem() {} });
    const s = safeStorage();
    expect(s).not.toBe(globalThis.localStorage);
    s.setItem("a", "1");
    expect(s.getItem("a")).toBe("1");
  });
});
