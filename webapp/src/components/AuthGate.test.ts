import { describe, expect, it } from "vitest";
import { fromLocation, safeReturnPath } from "./AuthGate.tsx";

describe("AuthGate return path", () => {
  it("keeps the query and hash so a pairing link survives the login detour", () => {
    expect(fromLocation({ pathname: "/settings", search: "?pair=123456", hash: "#devices" })).toBe("/settings?pair=123456#devices");
    expect(fromLocation({ pathname: "/", search: "", hash: "" })).toBe("/");
  });
  it("only returns to app-internal paths", () => {
    expect(safeReturnPath("/settings?pair=123456#devices")).toBe("/settings?pair=123456#devices");
    expect(safeReturnPath("//evil.example")).toBe("/");
    expect(safeReturnPath("https://evil.example")).toBe("/");
    expect(safeReturnPath(undefined)).toBe("/");
    expect(safeReturnPath(42)).toBe("/");
  });
});
