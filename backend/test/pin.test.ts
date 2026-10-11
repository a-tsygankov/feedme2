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
