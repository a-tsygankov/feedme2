import { describe, expect, it } from "vitest";
import { CAT_COLORS } from "@feedme2/shared";
import { catSaveError, colorName, defaultColor, parseHours } from "./cat-editor.ts";

describe("defaultColor", () => {
  it("is the first colour no other cat uses", () => {
    expect(defaultColor([])).toBe(CAT_COLORS[0]);
    expect(defaultColor([CAT_COLORS[0], CAT_COLORS[1]])).toBe(CAT_COLORS[2]);
    expect(defaultColor([CAT_COLORS[1]])).toBe(CAT_COLORS[0]);
  });
  it("falls back to the first colour when all are taken", () => {
    expect(defaultColor(CAT_COLORS)).toBe(CAT_COLORS[0]);
  });
});

describe("colorName", () => {
  it("names every palette colour, never a hex code", () => {
    for (const c of CAT_COLORS) expect(colorName(c)).toMatch(/^[A-Z][a-z]+$/);
  });
});

describe("parseHours", () => {
  it("parses 1–24 and rejects blank, junk and out of range", () => {
    expect(parseHours("5")).toBe(5);
    expect(parseHours(" 1.5 ")).toBe(1.5);
    expect(parseHours("1")).toBe(1);
    expect(parseHours("24")).toBe(24);
    for (const bad of ["", "  ", "abc", "0", "0.5", "25"]) expect(parseHours(bad)).toBeNull();
  });
});

describe("catSaveError", () => {
  it("maps a 409 on create to the cat limit", () => {
    expect(catSaveError({ status: 409, body: null }, true).message).toBe("You already have 8 cats.");
  });
  it("maps a 404 to a removed cat", () => {
    expect(catSaveError({ status: 404, body: null }, false).message).toBe("That cat was removed on another phone.");
  });
  it("maps a 400 to the offending field via issues[0].path", () => {
    const body = (path: string) => ({ error: "invalid_request", issues: [{ path: [path], message: "x" }] });
    expect(catSaveError({ status: 400, body: body("name") }, true).field).toBe("name");
    expect(catSaveError({ status: 400, body: body("hungryAfterSec") }, true).field).toBe("hours");
    expect(catSaveError({ status: 400, body: body("color") }, true).field).toBeNull();
  });
  it("handles a lost connection and anything else", () => {
    expect(catSaveError(Object.assign(new Error("x"), { name: "NetworkError" }), true).message).toBe("Check your connection.");
    expect(catSaveError(new Error("boom"), true).message).toBe("Couldn't save. Try again.");
    expect(catSaveError({ status: 500, body: null }, true).field).toBeNull();
  });
});
