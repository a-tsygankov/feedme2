/**
 * Calendar math in an explicit IANA zone. Reports, the dashboard's "today" and the Worker
 * must agree on day boundaries, so this is the one implementation (spec §1.4: the house's
 * zone, not the phone's). Date keys are plain calendar dates; only zonedParts, dateKeyOf
 * and midnightMs touch a zone.
 */
export type DateKey = string;

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function parseDateKey(k: string): { y: number; m: number; d: number } | null {
  const m = KEY.exec(k);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? { y, m: mo, d } : null;
}
export const isDateKey = (k: string): boolean => parseDateKey(k) !== null;

function utcOf(k: DateKey): number {
  const p = parseDateKey(k);
  if (!p) throw new RangeError(`bad date key ${k}`);
  return Date.UTC(p.y, p.m - 1, p.d);
}
const keyOfUtc = (ms: number): DateKey => new Date(ms).toISOString().slice(0, 10);

export const addDays = (k: DateKey, n: number): DateKey => keyOfUtc(utcOf(k) + n * DAY_MS);
export const daysBetween = (a: DateKey, b: DateKey): number => Math.round((utcOf(b) - utcOf(a)) / DAY_MS);
export function addMonths(k: DateKey, n: number): DateKey {
  const p = parseDateKey(k);
  if (!p) throw new RangeError(`bad date key ${k}`);
  const first = new Date(Date.UTC(p.y, p.m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return keyOfUtc(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(p.d, last)));
}
export const weekdayOf = (k: DateKey): number => (new Date(utcOf(k)).getUTCDay() + 6) % 7;
export const startOfWeek = (k: DateKey): DateKey => addDays(k, -weekdayOf(k));
export const startOfMonth = (k: DateKey): DateKey => `${k.slice(0, 8)}01`;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      // h23: some engines print "24" for midnight under the default hour cycle.
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    } catch {
      f = fmt("UTC");
    }
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts straight from Intl: the reference path, ~4 µs a call. */
function directParts(ms: number, tz: string) {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const y = p.year!, m = p.month!, d = p.day!;
  // % 24: an engine that prints "24" for midnight (see fmt) still means 00:00 of that same day.
  return { y, m, d, h: p.hour! % 24, mi: p.minute!, s: p.second!, weekday: (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 };
}

function directOffset(ms: number, tz: string): number {
  const p = directParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/*
 * Offset cache. aggregateReport asks for the parts of every feeding, and at ~4 µs an Intl call a
 * multi-year report blew the Workers 10 ms CPU budget (review of eebe3b1: 20 000 feedings, ~150 ms).
 * Offsets only change at transitions, so cache them per tz:
 *  - per UTC day: if the offset at the day's first and last second agree, it holds all day. Exact as
 *    long as a zone never has two transitions within 24 h; the closest pair across every
 *    Intl.supportedValuesOf("timeZone") zone is 35 days apart in 2024-2030 (Africa/Casablanca), 7 in 1970-2037.
 *  - a day with a transition falls to quarter-hour buckets (Math.floor(ms / 900_000)): every
 *    transition of every zone in 2024-2030 lands on a UTC quarter-hour, so all but one bucket of the
 *    day hit the cache. A bucket whose two ends still disagree (a non-aligned transition,
 *    such as America/Goose_Bay's at 00:01 local in 1987-2011) returns null and the caller reads Intl directly.
 * Offsets are whole seconds, so new Date(ms + offset)'s UTC fields are the wall clock exactly.
 */
const QUARTER_MS = 900_000;
const CACHE_LIMIT = 50_000;
const offsetCache = new Map<string, { days: Map<number, number>; quarters: Map<number, number> }>();

/** Offset constant over [start, start + len), or NaN when its first and last seconds disagree. */
function spanOffset(cache: Map<number, number>, idx: number, len: number, tz: string): number {
  let o = cache.get(idx);
  if (o === undefined) {
    const a = directOffset(idx * len, tz);
    o = a === directOffset(idx * len + len - 1000, tz) ? a : NaN;
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(idx, o);
  }
  return o;
}

function cachedOffset(ms: number, tz: string): number | null {
  let c = offsetCache.get(tz);
  if (!c) offsetCache.set(tz, (c = { days: new Map(), quarters: new Map() }));
  const day = spanOffset(c.days, Math.floor(ms / DAY_MS), DAY_MS, tz);
  if (!Number.isNaN(day)) return day;
  const q = spanOffset(c.quarters, Math.floor(ms / QUARTER_MS), QUARTER_MS, tz);
  return Number.isNaN(q) ? null : q;
}

export function zonedParts(ms: number, tz: string) {
  const off = cachedOffset(ms, tz);
  if (off === null) return directParts(ms, tz);
  const t = new Date(ms + off);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), weekday: (t.getUTCDay() + 6) % 7 };
}

export function dateKeyOf(ms: number, tz: string): DateKey {
  const p = zonedParts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

const offsetAt = (ms: number, tz: string): number => cachedOffset(ms, tz) ?? directOffset(ms, tz);

export function midnightMs(k: DateKey, tz: string): number {
  const wall = utcOf(k);
  // Two passes converge across a transition: first the offset at the wall time, then at the guess.
  let guess = wall - offsetAt(wall, tz);
  guess = wall - offsetAt(guess, tz);
  // A skipped midnight (America/Santiago 2026-09-06, America/Havana 2026-03-08) leaves the guess on
  // the previous day, one gap before the transition. The offset there is the one before the jump,
  // and wall minus it is the jump itself: the first instant of the day. Bounded in case a zone stacks
  // transitions; a jump that starts before 00:00 (none today) would land a little after the first instant.
  for (let i = 0; i < 3 && dateKeyOf(guess, tz) < k; i++) guess = wall - offsetAt(guess, tz);
  // A midnight that happens twice (clocks falling back onto 00:00: America/Havana 2026-11-01) gives the
  // 00:00 the first pass lands on: the earlier, true start of the day west of UTC, where the wall
  // time read as UTC precedes the transition; east of UTC the later one (no zone does that in 2024-2030).
  return guess;
}

export function dayBoundsMs(from: DateKey, to: DateKey, tz: string): { fromMs: number; toMs: number } {
  return { fromMs: midnightMs(from, tz), toMs: midnightMs(addDays(to, 1), tz) };
}
