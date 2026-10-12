import { describe, expect, it } from "vitest";
import { addDays, addMonths, dateKeyOf, dayBoundsMs, daysBetween, isDateKey, midnightMs, parseDateKey, startOfMonth, startOfWeek, weekdayOf, zonedParts } from "./zone.ts";

describe("date keys", () => {
  it("parses real dates only", () => {
    expect(parseDateKey("2026-03-29")).toEqual({ y: 2026, m: 3, d: 29 });
    expect(parseDateKey("2026-02-30")).toBeNull();
    expect(parseDateKey("2026-3-9")).toBeNull();
    expect(isDateKey("2024-02-29")).toBe(true);
    expect(isDateKey("2025-02-29")).toBe(false);
  });
  it("does pure calendar arithmetic", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
  });
  it("starts weeks on Monday", () => {
    expect(weekdayOf("2026-10-12")).toBe(0); // a Monday
    expect(weekdayOf("2026-10-18")).toBe(6);
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12");
    expect(startOfWeek("2026-10-12")).toBe("2026-10-12");
    expect(startOfMonth("2026-10-18")).toBe("2026-10-01");
  });
});

describe("instants in a zone", () => {
  it("reads wall-clock parts in the given zone, not the host's", () => {
    const ms = Date.UTC(2026, 2, 28, 23, 30); // 00:30 on the 29th in Berlin (CET, +1)
    expect(dateKeyOf(ms, "Europe/Berlin")).toBe("2026-03-29");
    expect(dateKeyOf(ms, "America/New_York")).toBe("2026-03-28");
    expect(zonedParts(ms, "Asia/Tokyo")).toMatchObject({ y: 2026, m: 3, d: 29, h: 8, mi: 30, weekday: 6 });
  });
  it("finds midnight across a spring-forward day (23 h)", () => {
    const start = midnightMs("2026-03-29", "Europe/Berlin");
    const next = midnightMs("2026-03-30", "Europe/Berlin");
    expect(start).toBe(Date.UTC(2026, 2, 28, 23));
    expect(next - start).toBe(23 * 3_600_000);
  });
  it("finds midnight across a fall-back day (25 h)", () => {
    expect(midnightMs("2026-10-26", "Europe/Berlin") - midnightMs("2026-10-25", "Europe/Berlin")).toBe(25 * 3_600_000);
  });
  it("returns the first instant of a day whose midnight does not exist", () => {
    // America/Santiago springs forward at 24:00 on 2026-09-05, so the 6th starts at 01:00 local.
    const ms = midnightMs("2026-09-06", "America/Santiago");
    expect(dateKeyOf(ms, "America/Santiago")).toBe("2026-09-06");
    expect(dateKeyOf(ms - 1, "America/Santiago")).toBe("2026-09-05");
  });
  it("gives half-open day bounds", () => {
    const b = dayBoundsMs("2026-03-01", "2026-03-31", "Europe/Berlin");
    expect(b.fromMs).toBe(midnightMs("2026-03-01", "Europe/Berlin"));
    expect(b.toMs).toBe(midnightMs("2026-04-01", "Europe/Berlin"));
  });
  it("falls back to UTC for an unknown zone instead of throwing", () => {
    expect(dateKeyOf(Date.UTC(2026, 0, 1, 23), "Not/AZone")).toBe("2026-01-01");
  });
});
