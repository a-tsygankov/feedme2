import { describe, expect, it } from "vitest";
import type { Feeding, FeedingCreate } from "@feedme2/shared";
import { applyPatch, editPatch, enteredAsText, formatFedAt, keepFedAtIfSameMinute, replaceFeeding } from "./feeding-history.ts";

const f = (id: string, fedAt: number, extra: Partial<Feeding> = {}): Feeding => ({
  id, houseId: "h", catId: "c1", fedAt, amountMg: 1000, enteredUnit: "g", enteredValue: "1", source: "web",
  deviceId: null, clientId: null, note: null, createdAt: 0, modifiedAt: 0, ...extra,
});
const data = (...pages: Feeding[][]) => ({ pages: pages.map((items, i) => ({ items, nextCursor: i < pages.length - 1 ? "x" : null })), pageParams: pages.map(() => undefined) });

describe("keepFedAtIfSameMinute", () => {
  it("restores the original time when only the seconds were lost to the minute-precision input", () => {
    const original = Date.UTC(2026, 9, 1, 12, 34, 56, 789);
    const edited = Date.UTC(2026, 9, 1, 12, 34, 0, 0);
    expect(keepFedAtIfSameMinute(edited, original)).toBe(original);
  });
  it("keeps the edited time when the minute really changed", () => {
    const original = Date.UTC(2026, 9, 1, 12, 34, 56);
    const edited = Date.UTC(2026, 9, 1, 12, 35, 0);
    expect(keepFedAtIfSameMinute(edited, original)).toBe(edited);
  });
});

describe("replaceFeeding", () => {
  it("replaces a feeding in place across pages", () => {
    const out = replaceFeeding(data([f("a", 30), f("b", 20)], [f("c", 10)]), "c", f("c", 10, { amountMg: 5 }));
    expect(out?.pages[1]?.items[0]?.amountMg).toBe(5);
    expect(out?.pages[0]?.items.map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("removes a feeding when next is null", () => {
    const out = replaceFeeding(data([f("a", 30), f("b", 20)]), "a", null);
    expect(out?.pages[0]?.items.map((x) => x.id)).toEqual(["b"]);
  });
  it("keeps the page newest-first after the time changed", () => {
    const out = replaceFeeding(data([f("a", 30), f("b", 20)]), "b", f("b", 40));
    expect(out?.pages[0]?.items.map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("passes undefined through and leaves other pages untouched", () => {
    expect(replaceFeeding(undefined, "a", null)).toBeUndefined();
    const d = data([f("a", 30)], [f("b", 20)]);
    expect(replaceFeeding(d, "a", null)?.pages[1]).toBe(d.pages[1]);
  });
});

describe("formatFedAt", () => {
  it("formats in the given timezone, not the phone's", () => {
    const t = Date.UTC(2026, 0, 15, 23, 30);
    expect(formatFedAt(t, "UTC", "en-US")).toContain("11:30");
    expect(formatFedAt(t, "Asia/Tokyo", "en-US")).toContain("8:30");
    expect(formatFedAt(t, "Asia/Tokyo", "en-US")).toContain("16");
  });
});

describe("editPatch", () => {
  const orig = f("a", Date.UTC(2026, 0, 1, 10, 0, 42), { amountMg: 50000, enteredUnit: "g", enteredValue: "50", note: "dry" });
  const item = (extra: Partial<FeedingCreate> = {}): FeedingCreate => ({ id: "a", catId: "c1", fedAt: Date.UTC(2026, 0, 1, 10, 0, 0), amountMg: 50000, enteredUnit: "g", enteredValue: "50", note: "dry", ...extra });
  it("is empty when nothing was touched (seconds do not count as a time change)", () => {
    expect(editPatch(orig, item())).toEqual({});
  });
  it("sends the amount triple only when the milligrams changed", () => {
    expect(editPatch(orig, item({ amountMg: 60000, enteredValue: "60" }))).toEqual({ amountMg: 60000, enteredUnit: "g", enteredValue: "60" });
    // A unit change alone must not rewrite how the original amount was entered.
    expect(editPatch(orig, item({ enteredUnit: "oz", enteredValue: "1.76" }))).toEqual({});
  });
  it("sends fedAt only when the minute changed, note only when it changed, cat only when moved", () => {
    expect(editPatch(orig, item({ fedAt: Date.UTC(2026, 0, 1, 10, 5, 0) }))).toEqual({ fedAt: Date.UTC(2026, 0, 1, 10, 5, 0) });
    expect(editPatch(orig, item({ note: "wet" }))).toEqual({ note: "wet" });
    const { note: _n, ...noNote } = item();
    expect(editPatch(orig, noNote)).toEqual({ note: null });
    expect(editPatch(orig, item({ catId: "c2" }))).toEqual({ catId: "c2" });
  });
});

describe("applyPatch", () => {
  it("merges only the sent keys", () => {
    const o = f("a", 100, { note: "x" });
    expect(applyPatch(o, { amountMg: 5, enteredUnit: "g", enteredValue: "5" })).toEqual({ ...o, amountMg: 5, enteredUnit: "g", enteredValue: "5" });
  });
});

describe("enteredAsText", () => {
  it("hides the entered text when it is in the displayed unit", () => {
    expect(enteredAsText(f("a", 1, { enteredUnit: "g", enteredValue: "50" }), "g")).toBeNull();
    expect(enteredAsText(f("a", 1, { enteredUnit: "can", enteredValue: "1/3" }), "g")).toBe("1/3 can");
  });
});
