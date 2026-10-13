import { describe, expect, it } from "vitest";
import { chartBucket, drillLevel, drillTo, parseReportFilters, rangeTitle, shiftRange, toSearchParams } from "./report-filters.ts";

const parse = (qs: string, today = "2026-03-18") => parseReportFilters(new URLSearchParams(qs), today);
const CAT = "123e4567-e89b-42d3-a456-426614174000";

describe("report filters", () => {
  it("defaults to the week around today, Monday-first", () => {
    expect(parse("")).toEqual({ range: "week", from: "2026-03-16", to: "2026-03-22", cat: null, unit: "house" });
  });
  it("normalises from to the range start", () => {
    expect(parse("range=month&from=2026-03-18")).toMatchObject({ from: "2026-03-01", to: "2026-03-31" });
    expect(parse("range=week&from=2026-03-29")).toMatchObject({ from: "2026-03-23", to: "2026-03-29" });
    expect(parse("range=day&from=2026-03-29")).toMatchObject({ from: "2026-03-29", to: "2026-03-29" });
  });
  it("rejects bad custom ranges and caps long ones", () => {
    expect(parse("range=custom&from=2026-03-10&to=2026-03-01")).toMatchObject({ range: "week" });
    expect(parse("range=custom&from=2026-02-30&to=2026-03-01")).toMatchObject({ range: "week" });
    expect(parse("range=custom&from=2020-01-01&to=2026-01-01").to).toBe("2022-01-01"); // from + 731 days (2020 is a leap year)
  });
  it("keeps cat and unit, round-trips through the URL", () => {
    const f = parse(`range=custom&from=2026-03-01&to=2026-03-10&cat=${CAT}&unit=can`);
    expect(f.cat).toBe(CAT);
    expect(parseReportFilters(toSearchParams(f), "2026-03-18")).toEqual(f);
    expect(toSearchParams(parse("")).toString()).toBe("range=week&from=2026-03-16");
  });
  it("shifts by the range's own size", () => {
    expect(shiftRange(parse("range=month&from=2026-01-01"), 1)).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(shiftRange(parse("range=week&from=2026-03-02"), -1)).toMatchObject({ from: "2026-02-23", to: "2026-03-01" });
    expect(shiftRange(parse("range=custom&from=2026-03-01&to=2026-03-10"), 1)).toMatchObject({ from: "2026-03-11", to: "2026-03-20" });
  });
  it("drills month → week → day → feedings", () => {
    const month = parse("range=month&from=2026-03-01");
    expect(drillLevel(month)).toBe("week");
    const week = drillTo(month, "2026-03-23");
    expect(week).toMatchObject({ range: "week", from: "2026-03-23", to: "2026-03-29" });
    expect(drillLevel(week)).toBe("day");
    const day = drillTo(week, "2026-03-29");
    expect(day).toMatchObject({ range: "day", from: "2026-03-29" });
    expect(drillLevel(day)).toBe("feedings");
    expect(drillTo(parse("range=custom&from=2025-01-01&to=2026-03-01"), "2025-06")).toMatchObject({ range: "month", from: "2025-06-01" });
  });
  it("picks chart buckets", () => {
    expect(chartBucket(parse("range=day&from=2026-03-29"))).toBe("hour");
    expect(chartBucket(parse("range=month&from=2026-03-01"))).toBe("day");
    // 425 days (365 + 31 + 28 + 1) is past defaultBucket's 400-day week limit; 365 days is not.
    expect(chartBucket(parse("range=custom&from=2025-01-01&to=2026-03-01"))).toBe("month");
    expect(chartBucket(parse("range=custom&from=2025-01-01&to=2025-12-31"))).toBe("week");
  });
  it("drops a cat id that is not a lowercase uuid (the Worker would answer 400 forever)", () => {
    expect(parse("cat=c1").cat).toBeNull();
    expect(parse(`cat=${CAT.toUpperCase()}`).cat).toBeNull();
    expect(parse(`cat=${CAT}x`).cat).toBeNull();
  });
  it("keeps from and to inside 2000-01-01..2999-12-31", () => {
    const week = { range: "week", from: "2026-03-16", to: "2026-03-22" };
    expect(() => parse("range=month&from=9999-12-15")).not.toThrow();
    expect(parse("range=month&from=9999-12-15")).toMatchObject(week);
    expect(parse("range=week&from=9999-12-31")).toMatchObject(week);
    expect(parse("range=day&from=0100-01-01")).toMatchObject(week);
    expect(parse("range=day&from=1999-12-31")).toMatchObject(week);
    // The week of 2999-12-31 ends in 3000, so it is outside too.
    expect(parse("range=week&from=2999-12-31")).toMatchObject(week);
    expect(parse("range=custom&from=1999-12-01&to=2000-01-10")).toMatchObject(week);
    expect(parse("range=custom&from=2999-12-01&to=3000-01-10")).toMatchObject(week);
    expect(parse("range=day&from=2000-01-01")).toMatchObject({ range: "day", from: "2000-01-01" });
    expect(parse("range=month&from=2999-12-15")).toMatchObject({ range: "month", from: "2999-12-01", to: "2999-12-31" });
  });
  it("never shifts outside the window", () => {
    const first = parse("range=day&from=2000-01-01");
    expect(shiftRange(first, -1)).toBe(first);
    const last = parse("range=month&from=2999-12-01");
    expect(shiftRange(last, 1)).toBe(last);
    const lastCustom = parse("range=custom&from=2999-12-20&to=2999-12-31");
    expect(shiftRange(lastCustom, 1)).toBe(lastCustom);
    // A filter built by hand outside the window (not via parse) stays put rather than throwing.
    const ancient = { range: "day", from: "0100-01-01", to: "0100-01-01", cat: null, unit: "house" } as const;
    expect(shiftRange(ancient, -1)).toBe(ancient);
    const ancientMonth = { ...ancient, range: "month", to: "0100-01-31" } as const;
    expect(shiftRange(ancientMonth, -1)).toBe(ancientMonth);
  });
  it("drillTo ignores malformed and hour keys", () => {
    const month = parse("range=month&from=2026-03-01");
    expect(drillTo(month, "2026-13")).toBe(month);
    expect(drillTo(month, "2026-00")).toBe(month);
    expect(drillTo(month, "9999-12")).toBe(month);
    expect(drillTo(month, "garbage")).toBe(month);
    const day = parse("range=day&from=2026-03-29");
    expect(drillTo(day, "2026-03-29T07")).toBe(day);
    expect(drillTo(day, "2026-03-29T07", "day")).toBe(day);
  });
  it("a one-day custom range drills to its feedings", () => {
    expect(drillLevel(parse("range=custom&from=2026-03-29&to=2026-03-29"))).toBe("feedings");
  });
  it("an explicit level decides what the key opens", () => {
    const month = parse("range=month&from=2026-03-01&unit=can");
    // The chart's day bar in the month view opens that day; the drill table's default opens its week.
    expect(drillTo(month, "2026-03-25", "day")).toMatchObject({ range: "day", from: "2026-03-25", to: "2026-03-25", unit: "can" });
    expect(drillTo(month, "2026-03-25")).toMatchObject({ range: "week", from: "2026-03-23" });
    expect(drillTo(month, "2026-03-25", "week")).toMatchObject({ range: "week", from: "2026-03-23", to: "2026-03-29" });
    const week = parse("range=week&from=2026-03-23");
    expect(drillTo(week, "2026-03-25", "month")).toMatchObject({ range: "month", from: "2026-03-01", to: "2026-03-31" });
    expect(drillTo(week, "2026-03", "month")).toMatchObject({ range: "month", from: "2026-03-01" });
    expect(drillTo(week, "2999-12-30", "week")).toBe(week);
  });
  it("titles ranges without the browser zone shifting a day", () => {
    expect(rangeTitle(parse("range=day&from=2026-03-29"))).toBe("Sun 29 Mar 2026");
    expect(rangeTitle(parse("range=month&from=2026-03-01"))).toBe("March 2026");
    expect(rangeTitle(parse("range=week&from=2026-03-23"))).toBe("23 – 29 Mar 2026");
    expect(rangeTitle(parse("range=week&from=2026-03-30"))).toBe("30 Mar – 5 Apr 2026");
    expect(rangeTitle(parse("range=week&from=2025-12-29"))).toBe("29 Dec 2025 – 4 Jan 2026");
    expect(rangeTitle(parse("range=custom&from=2026-03-01&to=2026-03-31"))).toBe("1 Mar 2026 – 31 Mar 2026");
  });
});
