import { describe, expect, it, vi } from "vitest";
import { aggregateReport, defaultBucket, MAX_HOUR_BUCKET_DAYS, periodKeyOf, periodKeys, REPORT_MAX_DATE, REPORT_MIN_DATE, ReportSummarySchema, type AggregateInput } from "./reports.ts";
import { __resetZoneCaches, addDays, dayBoundsMs, isDateKey, midnightMs, startOfWeek } from "./zone.ts";
import { SEED_CATS, SEED_FROM, SEED_TO, SEED_TZ, seedMonthFeedings } from "./testing/seed-month.ts";

const cats = SEED_CATS.map((c) => ({ ...c, deleted: false }));
const base = (over: Partial<AggregateInput> = {}): AggregateInput => ({
  feedings: seedMonthFeedings(), cats, from: SEED_FROM, to: SEED_TO, timeZone: SEED_TZ,
  bucket: "day", foodUnit: "g", canSizeMg: 155_922, ...over,
});

describe("aggregateReport over the seeded month", () => {
  const r = aggregateReport(base());

  it("parses under its own schema", () => expect(() => ReportSummarySchema.parse(r)).not.toThrow());

  it("totals", () => {
    expect(r.totals.feedings).toBe(154);
    expect(r.totals.amountMg).toBe(5_240_000);
    expect(r.totals.cans).toBe(33.61);
    expect(r.totals.longestGap).toMatchObject({ catId: SEED_CATS[1].id, sec: 18 * 3600 });
  });

  it("per cat, with the DST night shortening one interval", () => {
    const mochi = r.perCat.find((p) => p.catId === SEED_CATS[0].id)!;
    expect(mochi).toMatchObject({ feedings: 62, amountMg: 2_480_000, longestGapSec: 12.5 * 3600 });
    // First 07:30 CET on the 1st to last 19:00 CEST on the 31st is 730.5 h over 61 intervals.
    expect(mochi.meanIntervalSec).toBe(Math.round((730.5 * 3600) / 61));
  });

  it("one period per calendar day, the gap day has 4 feedings", () => {
    expect(r.periods).toHaveLength(31);
    expect(r.periods[14]).toMatchObject({ key: "2026-03-15", feedings: 4 });
    expect(r.periods[28]).toMatchObject({ key: "2026-03-29", feedings: 5 });
  });

  it("heatmap counts every feeding by local wall hour", () => {
    expect(r.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(154);
    expect(r.heatmap.reduce((a, row) => a + row[7]!, 0)).toBe(62); // 07:00 and 07:30
    expect(r.heatmap.reduce((a, row) => a + row[2]!, 0)).toBe(0);
  });

  it("interval histogram", () => {
    const by = Object.fromEntries(r.intervals.map((b) => [b.label, b.count]));
    expect(by["12–24 h"]).toBeGreaterThan(0);
    expect(r.intervals.reduce((a, b) => a + b.count, 0)).toBe(61 + 91);
  });

  it("matches the snapshot", () => expect(r).toMatchSnapshot());
});

describe("buckets", () => {
  it("chooses a default by span", () => {
    expect(defaultBucket("2026-03-29", "2026-03-29")).toBe("hour");
    expect(defaultBucket("2026-03-01", "2026-03-31")).toBe("day");
    expect(defaultBucket("2026-01-01", "2026-12-31")).toBe("week");
    expect(defaultBucket("2025-01-01", "2026-12-31")).toBe("month");
  });
  it("lists week keys by Monday and month keys by month", () => {
    expect(periodKeys("2026-03-01", "2026-03-31", "week")).toEqual(["2026-02-23", "2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"]);
    expect(periodKeys("2026-01-15", "2026-03-02", "month")).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
  it("derives the week key from the zoned parts exactly as startOfWeek does, every day of 2026", () => {
    const bad: string[] = [];
    for (const tz of [SEED_TZ, "America/Santiago", "Pacific/Kiritimati"]) {
      for (let d = "2026-01-01"; d <= "2026-12-31"; d = addDays(d, 1)) {
        // First instant, noon and last instant of the local day all belong to that day's week.
        const start = midnightMs(d, tz), end = midnightMs(addDays(d, 1), tz) - 1;
        for (const ms of [start, Math.round((start + end) / 2), end]) {
          const got = periodKeyOf(ms, "week", tz);
          if (got !== startOfWeek(d) && bad.length < 5) bad.push(`${tz} ${d} ${got}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
  it("hour buckets on the 23-hour day keep 24 keys and an empty T02", () => {
    const r = aggregateReport(base({ from: "2026-03-29", to: "2026-03-29", bucket: "hour" }));
    expect(r.periods).toHaveLength(24);
    expect(r.periods.find((p) => p.key === "2026-03-29T02")!.feedings).toBe(0);
    expect(r.totals.feedings).toBe(5);
  });
  it("hour buckets on the 25-hour day merge both 02:xx hours", () => {
    const day = "2026-10-25";
    const mid = midnightMs(day, SEED_TZ);
    const feedings = [
      { id: "a", catId: SEED_CATS[0].id, fedAt: mid + 2.5 * 3_600_000, amountMg: 1000 }, // 02:30 CEST
      { id: "b", catId: SEED_CATS[0].id, fedAt: mid + 3.5 * 3_600_000, amountMg: 1000 }, // 02:30 CET
    ];
    const r = aggregateReport(base({ feedings, from: day, to: day, bucket: "hour" }));
    expect(r.periods.find((p) => p.key === `${day}T02`)!.feedings).toBe(2);
  });
});

describe("edges", () => {
  it("counts the from-midnight instant and drops the instant the range ends", () => {
    const { fromMs, toMs } = dayBoundsMs("2026-03-10", "2026-03-10", SEED_TZ);
    const f = (id: string, fedAt: number) => ({ id, catId: SEED_CATS[0].id, fedAt, amountMg: 1000 });
    const r = aggregateReport(base({ feedings: [f("in1", fromMs), f("in2", toMs - 1), f("out", toMs)], from: "2026-03-10", to: "2026-03-10" }));
    expect(r.totals.feedings).toBe(2);
  });
  it("is all zeros and nulls on an empty range", () => {
    const r = aggregateReport(base({ feedings: [] }));
    expect(r.totals).toEqual({ feedings: 0, amountMg: 0, cans: 0, meanIntervalSec: null, longestGap: null });
    expect(r.perCat.every((p) => p.meanIntervalSec === null && p.longestGapSec === null)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });
  it("lists a removed cat only when it has feedings in range", () => {
    const removed = [{ ...cats[0]!, deleted: false }, { ...cats[1]!, deleted: true }];
    expect(aggregateReport(base({ cats: removed })).cats.map((c) => c.name)).toEqual(["Mochi", "Luna"]);
    const onlyMochi = seedMonthFeedings().filter((f) => f.catId === SEED_CATS[0].id);
    expect(aggregateReport(base({ cats: removed, feedings: onlyMochi })).cats.map((c) => c.name)).toEqual(["Mochi"]);
  });
});

describe("limits", () => {
  it("caps hour buckets at a week (7 × 24 = 168 periods)", () => expect(MAX_HOUR_BUCKET_DAYS).toBe(7));

  it("keeps every derived date key inside a four-digit year", () => {
    expect([REPORT_MIN_DATE, REPORT_MAX_DATE]).toEqual(["2000-01-01", "2999-12-31"]);
    // dayBoundsMs reads the day after `to`, the week bucket the Monday before `from`.
    expect(isDateKey(addDays(REPORT_MAX_DATE, 1))).toBe(true);
    expect(isDateKey(startOfWeek(REPORT_MIN_DATE))).toBe(true);
    expect(() => aggregateReport(base({ feedings: [], from: "2999-12-01", to: REPORT_MAX_DATE, bucket: "week" }))).not.toThrow();
  });

  it("asks Intl once per UTC day, not once per feeding (CPU on a two-year range)", () => {
    // Cold caches, or the count says nothing: a warm cache answers every feeding without Intl.
    // Each UTC day costs two formatToParts calls (its first and last second); the 23-hour
    // 2026-03-29 adds two per quarter-hour that holds a feeding (5), the bounds two more days.
    // 31 days + 2 bound days, ×2, + 5 quarters ×2 = 76; the bound is 2 × (31 + 2) + 16 = 82,
    // below the 154 feedings, so even one uncached lookup per feeding fails it.
    const inputs = (["hour", "day", "week", "month"] as const).map((bucket) => base({ bucket }));
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    try {
      for (const input of inputs) {
        __resetZoneCaches();
        spy.mockClear();
        aggregateReport(input);
        const n = spy.mock.calls.length;
        expect(n, input.bucket).toBeLessThanOrEqual(2 * (31 + 2) + 16);
        expect(n, input.bucket).toBeLessThan(input.feedings.length);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("the schema rejects a short interval histogram and negative counts", () => {
    const r = aggregateReport(base());
    expect(ReportSummarySchema.safeParse({ ...r, intervals: r.intervals.slice(1) }).success).toBe(false);
    expect(ReportSummarySchema.safeParse({ ...r, perCat: [{ ...r.perCat[0]!, feedings: -1 }] }).success).toBe(false);
    expect(ReportSummarySchema.safeParse({ ...r, periods: [{ ...r.periods[0]!, amountMg: -1 }] }).success).toBe(false);
    expect(ReportSummarySchema.safeParse({ ...r, periods: [{ ...r.periods[0]!, byCat: { x: { feedings: -1, amountMg: 0 } } }] }).success).toBe(false);
  });
});
