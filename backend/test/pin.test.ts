import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "../src/auth/pin.ts";

describe("pin hashing", () => {
  it("verifies the right pin and rejects a wrong one; salts differ per call", async () => {
    const a = await hashPin("1234");
    const b = await hashPin("1234");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyPin("1234", a.salt, a.hash)).toBe(true);
    expect(await verifyPin("1235", a.salt, a.hash)).toBe(false);
  });
});

describe("pin verification of bad stored values", () => {
  it("returns false, never throws, for empty or non-hex salt/hash", async () => {
    expect(await verifyPin("1234", "", "")).toBe(false);
    const good = await hashPin("1234");
    expect(await verifyPin("1234", "", good.hash)).toBe(false);
    expect(await verifyPin("1234", good.salt, "")).toBe(false);
    expect(await verifyPin("1234", "zz".repeat(16), good.hash)).toBe(false);
    expect(await verifyPin("1234", "abc", good.hash)).toBe(false);
    expect(await verifyPin("1234", good.salt, "not-hex")).toBe(false);
  });
});
