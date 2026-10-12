import {
  MAX_REPORT_DAYS,
  addDays,
  addMonths,
  daysBetween,
  defaultBucket,
  isDateKey,
  startOfMonth,
  startOfWeek,
  type DateKey,
  type ReportBucket,
} from "@feedme2/shared";

/**
 * Report filters live in the URL so a report is a shareable, back-button-friendly link.
 * Everything here is calendar math over date keys that are already in the house's zone
 * (the caller passes the house's `today`), so the browser's zone never enters: that is
 * Review Focus 2, a phone in Tokyo looking at a Berlin house.
 */
export type ReportRange = "day" | "week" | "month" | "custom";

export interface ReportFilters {
  range: ReportRange;
  from: DateKey;
  to: DateKey;
  cat: string | null;
  unit: "house" | "can";
}

const RANGES: readonly ReportRange[] = ["day", "week", "month", "custom"];
const MONTH_KEY = /^\d{4}-\d{2}$/;

/** A fixed-length range from any day inside it: from snaps to the range start, to is derived. */
function fixed(range: Exclude<ReportRange, "custom">, day: DateKey, cat: string | null, unit: ReportFilters["unit"]): ReportFilters {
  if (range === "day") return { range, from: day, to: day, cat, unit };
  if (range === "week") {
    const from = startOfWeek(day);
    return { range, from, to: addDays(from, 6), cat, unit };
  }
  const from = startOfMonth(day);
  return { range, from, to: addDays(addMonths(from, 1), -1), cat, unit };
}

export function parseReportFilters(params: URLSearchParams, today: DateKey): ReportFilters {
  const rawRange = params.get("range");
  const range: ReportRange = RANGES.includes(rawRange as ReportRange) ? (rawRange as ReportRange) : "week";
  const cat = params.get("cat") || null;
  const unit = params.get("unit") === "can" ? "can" : "house";
  const rawFrom = params.get("from");
  const from = rawFrom !== null && isDateKey(rawFrom) ? rawFrom : null;

  if (range !== "custom") return fixed(range, from ?? today, cat, unit);

  const rawTo = params.get("to");
  const to = rawTo !== null && isDateKey(rawTo) ? rawTo : null;
  // A hand-edited or stale link with an impossible or reversed range shows the default
  // report instead of an error page.
  if (from === null || to === null || to < from) return fixed("week", today, cat, unit);
  // The Worker rejects spans over MAX_REPORT_DAYS; cut here so a pasted 10-year link
  // still opens on its first two years rather than failing.
  const capped = daysBetween(from, to) + 1 > MAX_REPORT_DAYS ? addDays(from, MAX_REPORT_DAYS - 1) : to;
  return { range, from, to: capped, cat, unit };
}

export function toSearchParams(f: ReportFilters): URLSearchParams {
  const p = new URLSearchParams();
  p.set("range", f.range);
  p.set("from", f.from);
  if (f.range === "custom") p.set("to", f.to);
  if (f.cat !== null) p.set("cat", f.cat);
  if (f.unit === "can") p.set("unit", "can");
  return p;
}

export function shiftRange(f: ReportFilters, dir: 1 | -1): ReportFilters {
  if (f.range === "day") return fixed("day", addDays(f.from, dir), f.cat, f.unit);
  if (f.range === "week") return fixed("week", addDays(f.from, 7 * dir), f.cat, f.unit);
  if (f.range === "month") return fixed("month", addMonths(f.from, dir), f.cat, f.unit);
  const len = daysBetween(f.from, f.to) + 1;
  return { ...f, from: addDays(f.from, len * dir), to: addDays(f.to, len * dir) };
}

export function chartBucket(f: ReportFilters): ReportBucket {
  if (f.range === "day") return "hour";
  if (f.range === "custom") return defaultBucket(f.from, f.to);
  return "day";
}

export function drillLevel(f: ReportFilters): "week" | "day" | "feedings" | ReportBucket {
  if (f.range === "month") return "week";
  if (f.range === "week") return "day";
  if (f.range === "day") return "feedings";
  return chartBucket(f);
}

export function drillTo(f: ReportFilters, key: string): ReportFilters {
  if (MONTH_KEY.test(key)) return fixed("month", `${key}-01`, f.cat, f.unit);
  // An hour key (YYYY-MM-DDTHH) opens its day: there is no range finer than a day.
  const day = key.slice(0, 10);
  if (!isDateKey(day)) return f;
  return fixed(drillLevel(f) === "week" ? "week" : "day", day, f.cat, f.unit);
}

// Format the key's own calendar date at UTC midnight in UTC, so no browser zone can shift it.
const utcOf = (k: DateKey): number => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
const fmtDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtMonth = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });

/** Parts joined by spaces: en-GB puts a comma after the weekday ("Sun, 29 Mar 2026"), which the design drops. */
function parts(k: DateKey, want: readonly ("weekday" | "day" | "month" | "year")[]): string {
  const p = Object.fromEntries(fmtDay.formatToParts(utcOf(k)).map((x) => [x.type, x.value]));
  return want.map((t) => p[t]).join(" ");
}

export function rangeTitle(f: ReportFilters): string {
  if (f.range === "day") return parts(f.from, ["weekday", "day", "month", "year"]);
  if (f.range === "month") return fmtMonth.format(utcOf(f.from));
  const full = (k: DateKey) => parts(k, ["day", "month", "year"]);
  if (f.range === "custom") return `${full(f.from)} – ${full(f.to)}`;
  // A week names only what differs: "23 – 29 Mar 2026", "30 Mar – 5 Apr 2026", "29 Dec 2025 – 4 Jan 2026".
  const head =
    f.from.slice(0, 4) !== f.to.slice(0, 4) ? full(f.from)
    : f.from.slice(0, 7) !== f.to.slice(0, 7) ? parts(f.from, ["day", "month"])
    : parts(f.from, ["day"]);
  return `${head} – ${full(f.to)}`;
}
