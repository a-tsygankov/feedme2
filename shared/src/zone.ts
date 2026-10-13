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

/*
 * Offset cache. aggregateReport asks for the parts of every feeding, and at ~4 µs an Intl call a
 * multi-year report blew the Workers 10 ms CPU budget (review of eebe3b1: 20 000 feedings, ~150 ms).
 * Offsets only change at transitions, so cache them per zone:
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
interface Zone { fmt: Intl.DateTimeFormat; days: Map<number, number>; quarters: Map<number, number> }

/*
 * Zones are keyed by Intl's canonical name, so "europe/berlin" and "Europe/Berlin" share one offset
 * cache. Intl also takes any case variant and offsets such as "+05:00" or "+0500", and an unknown
 * name falls back to UTC under its own spelling, so both maps are capped (review of f1f64c8: the
 * raw-string keys were unbounded in principle). A cleared map only costs Intl calls, never answers.
 */
const ZONE_LIMIT = 64;
const zones = new Map<string, Zone>();   // canonical name -> zone
const aliases = new Map<string, Zone>(); // caller's spelling -> zone

function zone(tz: string): Zone {
  let z = aliases.get(tz);
  if (z) return z;
  let f: Intl.DateTimeFormat;
  try {
    // h23: some engines print "24" for midnight under the default hour cycle.
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  } catch {
    f = zone("UTC").fmt;
  }
  const name = f.resolvedOptions().timeZone;
  z = zones.get(name);
  if (!z) {
    if (zones.size >= ZONE_LIMIT) zones.clear();
    zones.set(name, (z = { fmt: f, days: new Map(), quarters: new Map() }));
  }
  if (aliases.size >= ZONE_LIMIT) aliases.clear();
  aliases.set(tz, z);
  return z;
}

/** Test-only: forget every zone, so a test can count the Intl calls of a cold run. */
export function __resetZoneCaches(): void {
  zones.clear();
  aliases.clear();
}
/** Test-only: how many zones and spellings are cached. */
export const __zoneCacheSizes = (): { zones: number; aliases: number } => ({ zones: zones.size, aliases: aliases.size });

/** Wall-clock parts straight from Intl: the reference path, ~4 µs a call. */
function directParts(ms: number, f: Intl.DateTimeFormat) {
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const y = p.year!, m = p.month!, d = p.day!;
  // % 24: an engine that prints "24" for midnight (see zone) still means 00:00 of that same day.
  return { y, m, d, h: p.hour! % 24, mi: p.minute!, s: p.second!, weekday: (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 };
}

function directOffset(ms: number, f: Intl.DateTimeFormat): number {
  const p = directParts(ms, f);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Offset constant over [start, start + len), or NaN when its first and last seconds disagree. */
function spanOffset(cache: Map<number, number>, idx: number, len: number, f: Intl.DateTimeFormat): number {
  let o = cache.get(idx);
  if (o === undefined) {
    const a = directOffset(idx * len, f);
    o = a === directOffset(idx * len + len - 1000, f) ? a : NaN;
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(idx, o);
  }
  return o;
}

function cachedOffset(ms: number, z: Zone): number | null {
  const day = spanOffset(z.days, Math.floor(ms / DAY_MS), DAY_MS, z.fmt);
  if (!Number.isNaN(day)) return day;
  const q = spanOffset(z.quarters, Math.floor(ms / QUARTER_MS), QUARTER_MS, z.fmt);
  return Number.isNaN(q) ? null : q;
}

export function zonedParts(ms: number, tz: string) {
  const z = zone(tz);
  const off = cachedOffset(ms, z);
  if (off === null) return directParts(ms, z.fmt);
  const t = new Date(ms + off);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), weekday: (t.getUTCDay() + 6) % 7 };
}

export function dateKeyOf(ms: number, tz: string): DateKey {
  const p = zonedParts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function offsetAt(ms: number, tz: string): number {
  const z = zone(tz);
  return cachedOffset(ms, z) ?? directOffset(ms, z.fmt);
}

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
