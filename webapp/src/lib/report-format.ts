import { addDays, formatAmount, zonedParts, type DateKey, type FoodUnit, type ReportBucket } from "@feedme2/shared";

/**
 * Display strings for the Reports screen and the cat page's trends. Every key is already a calendar date (or hour,
 * or month) in the house's zone, so these format the key's own date at UTC midnight in UTC: no browser zone can
 * shift a label by a day (Review Focus 2).
 */

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "45 m", "11 h 58 m", "18 h", "1 d 2 h". Seconds are floored: 11 h 58 m 31 s is not "11 h 59 m". */
export function formatDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.floor(sec);
  if (s < HOUR) return `${Math.floor(s / MIN)} m`;
  if (s < DAY) {
    const h = Math.floor(s / HOUR);
    const m = Math.floor((s % HOUR) / MIN);
    return m === 0 ? `${h} h` : `${h} h ${m} m`;
  }
  const d = Math.floor(s / DAY);
  const h = Math.floor((s % DAY) / HOUR);
  return h === 0 ? `${d} d` : `${d} d ${h} h`;
}

export interface UnitHouse { foodUnit: FoodUnit; canSizeMg: number }

/** An amount in the house's unit, or as decimal cans (the "Cans" toggle: "33.61 cans", not a glyph). */
export function formatTotal(mg: number, unit: "house" | "can", house: UnitHouse): string {
  if (unit === "house") return formatAmount(mg, house.foodUnit, house.canSizeMg);
  if (!Number.isFinite(mg) || house.canSizeMg <= 0) return "—";
  return `${(mg / house.canSizeMg).toFixed(2)} cans`;
}

const utcOf = (k: DateKey): number => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)) || 1);
const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
/** Parts joined by spaces: en-GB would put a comma after the weekday. */
function parts(k: DateKey, want: readonly ("weekday" | "day" | "month" | "year")[]): string {
  const p = Object.fromEntries(fmt.formatToParts(utcOf(k)).map((x) => [x.type, x.value]));
  return want.map((t) => p[t]).join(" ");
}

/** The chart's axis label: "07" for an hour, "29" for a day, "23 Mar" for a week (its Monday), "Mar" for a month. */
export function periodLabel(key: string, bucket: ReportBucket): string {
  if (bucket === "hour") return key.slice(11, 13);
  if (bucket === "day") return String(Number(key.slice(8, 10)));
  if (bucket === "week") return parts(key, ["day", "month"]);
  return parts(`${key}-01`, ["month"]);
}

/**
 * A week row: "23 – 29 Mar", "23 Feb – 1 Mar", "29 Dec 2025 – 4 Jan 2026". A week the range cuts says so: its
 * bucket is keyed by its Monday, but only the days inside from..to were counted, so "23 Feb – 1 Mar" alone would
 * overstate it.
 */
export function weekRowLabel(monday: DateKey, from: DateKey, to: DateKey): string {
  const sunday = addDays(monday, 6);
  const tail = parts(sunday, monday.slice(0, 4) !== sunday.slice(0, 4) ? ["day", "month", "year"] : ["day", "month"]);
  const head =
    monday.slice(0, 4) !== sunday.slice(0, 4) ? parts(monday, ["day", "month", "year"])
    : monday.slice(0, 7) !== sunday.slice(0, 7) ? parts(monday, ["day", "month"])
    : parts(monday, ["day"]);
  const cut = monday < from ? ` (from ${parts(from, ["day", "month"])})` : sunday > to ? ` (until ${parts(to, ["day", "month"])})` : "";
  return `${head} – ${tail}${cut}`;
}

/** A drill-table row: a week as above, a day as "Mon 23 Mar", a month as "Mar 2026". */
export function drillRowLabel(key: string, bucket: ReportBucket, from: DateKey, to: DateKey): string {
  if (bucket === "week") return weekRowLabel(key, from, to);
  if (bucket === "month") return parts(`${key}-01`, ["month", "year"]);
  if (bucket === "hour") return `${key.slice(11, 13)}:00`;
  return parts(key, ["weekday", "day", "month"]);
}

/** HH:MM of an instant on the house's wall clock (the shared zone math, so it agrees with the buckets). */
export function clockTime(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
}

/** A removed cat's feedings still count, so it still needs a name, marked as gone (Review Focus 3). */
export const catLabel = (c: { name: string; deleted: boolean }): string => (c.deleted ? `${c.name} (removed)` : c.name);
