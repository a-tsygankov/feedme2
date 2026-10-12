import { describe, expect, it, vi } from "vitest";
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
  it("returns the first instant of a 2026 skipped midnight east and west of UTC", () => {
    // Havana (-5 to -4) and Beirut (+2 to +3) both jump from 00:00 to 01:00, on 2026-03-08 and 2026-03-29.
    expect(midnightMs("2026-03-08", "America/Havana")).toBe(Date.UTC(2026, 2, 8, 5));
    expect(midnightMs("2026-03-29", "Asia/Beirut")).toBe(Date.UTC(2026, 2, 28, 22));
    for (const [k, tz] of [["2026-03-08", "America/Havana"], ["2026-03-29", "Asia/Beirut"]] as const) {
      const ms = midnightMs(k, tz);
      expect(zonedParts(ms, tz)).toMatchObject({ h: 1, mi: 0, s: 0 });
      expect(dateKeyOf(ms - 1, tz)).toBe(addDays(k, -1));
    }
  });
  it("starts a twice-occurring midnight at its first 00:00 west of UTC", () => {
    // Havana falls back from 01:00 to 00:00 on 2026-11-01, so local midnight happens at 04:00Z and 05:00Z.
    const ms = midnightMs("2026-11-01", "America/Havana");
    expect(ms).toBe(Date.UTC(2026, 10, 1, 4));
    expect(dateKeyOf(ms - 1, "America/Havana")).toBe("2026-10-31");
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

describe("zonedParts against Intl directly", () => {
  const ref = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
  const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  // St_Johns (-3:30) moves at 05:30Z/04:30Z, Lord_Howe by 30 minutes, Kathmandu sits at +5:45: none hour-aligned in UTC.
  for (const tz of ["Europe/Berlin", "America/St_Johns", "Australia/Lord_Howe", "Asia/Kathmandu"]) {
    it(`matches formatToParts every quarter-hour of 2026 (and ±1 ms) in ${tz}`, () => {
      const f = ref(tz);
      const bad: string[] = [];
      for (let q = Date.UTC(2026, 0, 1); q < Date.UTC(2027, 0, 1); q += 900_000) {
        for (const ms of [q - 1, q, q + 1]) {
          const p: Record<string, string> = {};
          for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
          const want = { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour! % 24, mi: +p.minute!, s: +p.second!, weekday: WD.indexOf(p.weekday!) };
          const got = zonedParts(ms, tz);
          if (JSON.stringify(got) !== JSON.stringify(want) && bad.length < 5) bad.push(`${new Date(ms).toISOString()} ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
        }
      }
      expect(bad).toEqual([]);
    }, 60_000);
  }
  it("reads hour 24 as midnight on engines that print it", () => {
    // Older V8 printed "24" for 00:00 even with hourCycle h23; these zones are ones no other test warms.
    const real = Intl.DateTimeFormat.prototype.formatToParts;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function (this: Intl.DateTimeFormat, d) {
      return real.call(this, d).map((x) => (x.type === "hour" && x.value === "00" ? { ...x, value: "24" } : x));
    });
    try {
      expect(zonedParts(Date.UTC(2026, 4, 31, 15), "Asia/Seoul")).toMatchObject({ y: 2026, m: 6, d: 1, h: 0, mi: 0, weekday: 0 });
      expect(dateKeyOf(Date.UTC(2026, 4, 31, 15, 30), "Asia/Seoul")).toBe("2026-06-01");
      // Abidjan is UTC+0, so the offset probe at a UTC day start itself reads 00:00 local.
      expect(zonedParts(Date.UTC(2026, 4, 31, 0, 10), "Africa/Abidjan")).toMatchObject({ y: 2026, m: 5, d: 31, h: 0, mi: 10 });
    } finally {
      spy.mockRestore();
    }
  });
});
