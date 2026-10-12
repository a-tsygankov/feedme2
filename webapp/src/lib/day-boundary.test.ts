import { afterEach, describe, expect, it, vi } from "vitest";
import { startOfDayInZone } from "./day-boundary.ts";

describe("startOfDayInZone", () => {
  it("UTC: midnight UTC of the same day", () => {
    expect(startOfDayInZone(Date.UTC(2026, 2, 15, 13, 45, 10), "UTC")).toBe(Date.UTC(2026, 2, 15));
    expect(startOfDayInZone(Date.UTC(2026, 2, 15, 0, 0, 0), "UTC")).toBe(Date.UTC(2026, 2, 15));
    expect(startOfDayInZone(Date.UTC(2026, 2, 15, 23, 59, 59), "UTC")).toBe(Date.UTC(2026, 2, 15));
  });

  it("Asia/Tokyo (UTC+9, no DST): the local day starts at 15:00Z the day before", () => {
    expect(startOfDayInZone(Date.UTC(2026, 5, 1, 20, 0), "Asia/Tokyo")).toBe(Date.UTC(2026, 5, 1, 15));
    expect(startOfDayInZone(Date.UTC(2026, 5, 1, 14, 59), "Asia/Tokyo")).toBe(Date.UTC(2026, 4, 31, 15));
  });

  it("America/New_York on the spring-forward day: midnight is EST (05:00Z) though now is EDT", () => {
    // 2026-03-08 02:00 EST jumps to 03:00 EDT.
    expect(startOfDayInZone(Date.UTC(2026, 2, 8, 20, 0), "America/New_York")).toBe(Date.UTC(2026, 2, 8, 5));
    expect(startOfDayInZone(Date.UTC(2026, 2, 9, 3, 0), "America/New_York")).toBe(Date.UTC(2026, 2, 8, 5));
    // The next day is a 24 h EDT day.
    expect(startOfDayInZone(Date.UTC(2026, 2, 9, 12, 0), "America/New_York")).toBe(Date.UTC(2026, 2, 9, 4));
  });

  it("America/New_York on the fall-back day: midnight is EDT (04:00Z) though now is EST", () => {
    expect(startOfDayInZone(Date.UTC(2026, 10, 1, 12, 0), "America/New_York")).toBe(Date.UTC(2026, 10, 1, 4));
  });

  it("falls back to the device-local day for an unknown zone instead of throwing", () => {
    const now = Date.UTC(2026, 2, 15, 13, 45);
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    expect(startOfDayInZone(now, "Not/AZone")).toBe(d.getTime());
  });

  describe("zone validity cache", () => {
    afterEach(() => vi.restoreAllMocks());

    it("checks a zone's validity once, not on every call (the dashboard asks on every 30 s tick)", () => {
      const spy = vi.spyOn(Intl, "DateTimeFormat");
      const now = Date.UTC(2026, 2, 15, 13, 45);
      startOfDayInZone(now, "Not/AnotherZone");
      const first = spy.mock.calls.length;
      expect(first).toBeGreaterThan(0);
      startOfDayInZone(now, "Not/AnotherZone");
      startOfDayInZone(now + 1, "Not/AnotherZone");
      expect(spy.mock.calls.length).toBe(first);
    });

    it("still answers correctly from the cache", () => {
      const at = Date.UTC(2026, 5, 1, 20, 0);
      expect(startOfDayInZone(at, "Asia/Tokyo")).toBe(Date.UTC(2026, 5, 1, 15));
      expect(startOfDayInZone(at, "Asia/Tokyo")).toBe(Date.UTC(2026, 5, 1, 15));
    });
  });
});
