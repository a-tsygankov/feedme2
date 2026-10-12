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

export function zonedParts(ms: number, tz: string) {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const y = p.year!, m = p.month!, d = p.day!;
  return { y, m, d, h: p.hour!, mi: p.minute!, s: p.second!, weekday: (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 };
}

export function dateKeyOf(ms: number, tz: string): DateKey {
  const p = zonedParts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function offsetAt(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

export function midnightMs(k: DateKey, tz: string): number {
  const wall = utcOf(k);
  // Two passes converge across a transition: first the offset at the wall time, then at the guess.
  let guess = wall - offsetAt(wall, tz);
  guess = wall - offsetAt(guess, tz);
  // A skipped midnight (e.g. America/Santiago) leaves the guess on the previous day: step to the first real hour.
  for (let i = 0; i < 3 && dateKeyOf(guess, tz) < k; i++) guess += 3_600_000;
  return guess;
}

export function dayBoundsMs(from: DateKey, to: DateKey, tz: string): { fromMs: number; toMs: number } {
  return { fromMs: midnightMs(from, tz), toMs: midnightMs(addDays(to, 1), tz) };
}
