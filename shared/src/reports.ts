/**
 * Report aggregation (spec §1.3 Reports, §4.4). Pure, so the Worker serves it and the tests
 * snapshot it; every bucket is a calendar unit in the house zone (spec §1.4).
 */
import { z } from "zod";
import { FoodUnitSchema, type FoodUnit } from "./api.ts";
import { addDays, dateKeyOf, dayBoundsMs, daysBetween, isDateKey, startOfWeek, zonedParts, type DateKey } from "./zone.ts";

export const MAX_REPORT_DAYS = 732;
export const DateKeySchema = z.string().refine(isDateKey, "expected a real date YYYY-MM-DD");
export const ReportBucketSchema = z.enum(["hour", "day", "week", "month"]);
export type ReportBucket = z.infer<typeof ReportBucketSchema>;

const H = 3600;
export const INTERVAL_BUCKETS = [
  { label: "<2 h", minSec: 0, maxSec: 2 * H },
  { label: "2–4 h", minSec: 2 * H, maxSec: 4 * H },
  { label: "4–6 h", minSec: 4 * H, maxSec: 6 * H },
  { label: "6–8 h", minSec: 6 * H, maxSec: 8 * H },
  { label: "8–12 h", minSec: 8 * H, maxSec: 12 * H },
  { label: "12–24 h", minSec: 12 * H, maxSec: 24 * H },
  { label: "24 h+", minSec: 24 * H, maxSec: null },
] as const;

export const ReportSummarySchema = z.object({
  from: DateKeySchema,
  to: DateKeySchema,
  timeZone: z.string(),
  bucket: ReportBucketSchema,
  foodUnit: FoodUnitSchema,
  canSizeMg: z.number().int().positive(),
  cats: z.array(z.object({ id: z.string(), name: z.string(), color: z.string(), deleted: z.boolean() })),
  totals: z.object({
    feedings: z.number().int().nonnegative(),
    amountMg: z.number().int().nonnegative(),
    cans: z.number().nonnegative(),                     // amountMg / canSizeMg, 2 decimals
    meanIntervalSec: z.number().int().nullable(),        // over every per-cat interval in range
    longestGap: z.object({ catId: z.string(), sec: z.number().int(), fromMs: z.number().int(), toMs: z.number().int() }).nullable(),
  }),
  perCat: z.array(z.object({
    catId: z.string(), feedings: z.number().int(), amountMg: z.number().int(),
    meanIntervalSec: z.number().int().nullable(), longestGapSec: z.number().int().nullable(),
  })),
  periods: z.array(z.object({
    key: z.string(), feedings: z.number().int(), amountMg: z.number().int(),
    byCat: z.record(z.string(), z.object({ feedings: z.number().int(), amountMg: z.number().int() })),
  })),
  intervals: z.array(z.object({ label: z.string(), minSec: z.number().int(), maxSec: z.number().int().nullable(), count: z.number().int() })),
  heatmap: z.array(z.array(z.number().int()).length(24)).length(7),   // [weekday Mon=0][hour 0..23]
});
export type ReportSummary = z.infer<typeof ReportSummarySchema>;

export interface ReportFeeding { id: string; catId: string; fedAt: number; amountMg: number }
export interface ReportCat { id: string; name: string; color: string; deleted: boolean }
export interface AggregateInput {
  feedings: ReportFeeding[]; cats: ReportCat[]; from: DateKey; to: DateKey; timeZone: string;
  bucket: ReportBucket; foodUnit: FoodUnit; canSizeMg: number;
}

export function defaultBucket(from: DateKey, to: DateKey): ReportBucket {
  const n = daysBetween(from, to) + 1;
  return n <= 1 ? "hour" : n <= 92 ? "day" : n <= 400 ? "week" : "month";
}

const pad = (n: number) => String(n).padStart(2, "0");

export function periodKeyOf(ms: number, bucket: ReportBucket, tz: string): string {
  const day = dateKeyOf(ms, tz);
  if (bucket === "hour") return `${day}T${pad(zonedParts(ms, tz).h)}`;
  if (bucket === "day") return day;
  if (bucket === "week") return startOfWeek(day);
  return day.slice(0, 7);
}

export function periodKeys(from: DateKey, to: DateKey, bucket: ReportBucket): string[] {
  const keys: string[] = [];
  if (bucket === "hour") {
    for (let d = from; d <= to; d = addDays(d, 1)) for (let h = 0; h < 24; h++) keys.push(`${d}T${pad(h)}`);
  } else if (bucket === "day") {
    for (let d = from; d <= to; d = addDays(d, 1)) keys.push(d);
  } else if (bucket === "week") {
    for (let d = startOfWeek(from); d <= to; d = addDays(d, 7)) keys.push(d);
  } else {
    for (let d = `${from.slice(0, 7)}-01`; d <= to; ) {
      keys.push(d.slice(0, 7));
      const [y, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))];
      d = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
    }
  }
  return keys;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function aggregateReport(i: AggregateInput): ReportSummary {
  const { fromMs, toMs } = dayBoundsMs(i.from, i.to, i.timeZone);
  const inRange = i.feedings
    .filter((f) => f.fedAt >= fromMs && f.fedAt < toMs)
    .sort((a, b) => a.fedAt - b.fedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const periods = new Map(periodKeys(i.from, i.to, i.bucket).map((k) => [k, { key: k, feedings: 0, amountMg: 0, byCat: {} as Record<string, { feedings: number; amountMg: number }> }]));
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const byCat = new Map<string, ReportFeeding[]>();
  let amountMg = 0;
  for (const f of inRange) {
    amountMg += f.amountMg;
    const p = periods.get(periodKeyOf(f.fedAt, i.bucket, i.timeZone));
    if (p) {
      p.feedings++; p.amountMg += f.amountMg;
      const c = (p.byCat[f.catId] ??= { feedings: 0, amountMg: 0 });
      c.feedings++; c.amountMg += f.amountMg;
    }
    const zp = zonedParts(f.fedAt, i.timeZone);
    const row = heatmap[zp.weekday]!;
    row[zp.h] = (row[zp.h] ?? 0) + 1;
    (byCat.get(f.catId) ?? byCat.set(f.catId, []).get(f.catId)!).push(f);
  }

  const intervals = INTERVAL_BUCKETS.map((b) => ({ label: b.label, minSec: b.minSec, maxSec: b.maxSec, count: 0 }));
  const all: number[] = [];
  let longestGap: ReportSummary["totals"]["longestGap"] = null;
  const perCat = i.cats
    .filter((c) => !c.deleted || byCat.has(c.id))
    .map((c) => {
      const fs = byCat.get(c.id) ?? [];
      const gaps: number[] = [];
      for (let k = 1; k < fs.length; k++) {
        const sec = Math.round((fs[k]!.fedAt - fs[k - 1]!.fedAt) / 1000);
        gaps.push(sec);
        all.push(sec);
        intervals.find((b) => sec >= b.minSec && (b.maxSec === null || sec < b.maxSec))!.count++;
        if (!longestGap || sec > longestGap.sec) longestGap = { catId: c.id, sec, fromMs: fs[k - 1]!.fedAt, toMs: fs[k]!.fedAt };
      }
      return {
        catId: c.id,
        feedings: fs.length,
        amountMg: fs.reduce((a, f) => a + f.amountMg, 0),
        meanIntervalSec: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
        longestGapSec: gaps.length ? Math.max(...gaps) : null,
      };
    });

  return {
    from: i.from, to: i.to, timeZone: i.timeZone, bucket: i.bucket, foodUnit: i.foodUnit, canSizeMg: i.canSizeMg,
    cats: i.cats.filter((c) => !c.deleted || byCat.has(c.id)).map(({ id, name, color, deleted }) => ({ id, name, color, deleted })),
    totals: {
      feedings: inRange.length,
      amountMg,
      cans: round2(amountMg / i.canSizeMg),
      meanIntervalSec: all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null,
      longestGap,
    },
    perCat,
    periods: [...periods.values()],
    intervals,
    heatmap,
  };
}
