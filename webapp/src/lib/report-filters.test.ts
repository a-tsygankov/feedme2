import { describe, expect, it } from "vitest";
import { chartBucket, drillLevel, drillTo, parseReportFilters, rangeTitle, shiftRange, toSearchParams } from "./report-filters.ts";

const parse = (qs: string, today = "2026-03-18") => parseReportFilters(new URLSearchParams(qs), today);

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
    const f = parse("range=custom&from=2026-03-01&to=2026-03-10&cat=c1&unit=can");
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
  it("titles ranges without the browser zone shifting a day", () => {
    expect(rangeTitle(parse("range=day&from=2026-03-29"))).toBe("Sun 29 Mar 2026");
    expect(rangeTitle(parse("range=month&from=2026-03-01"))).toBe("March 2026");
    expect(rangeTitle(parse("range=week&from=2026-03-23"))).toBe("23 – 29 Mar 2026");
    expect(rangeTitle(parse("range=week&from=2026-03-30"))).toBe("30 Mar – 5 Apr 2026");
    expect(rangeTitle(parse("range=week&from=2025-12-29"))).toBe("29 Dec 2025 – 4 Jan 2026");
    expect(rangeTitle(parse("range=custom&from=2026-03-01&to=2026-03-31"))).toBe("1 Mar 2026 – 31 Mar 2026");
  });
});
