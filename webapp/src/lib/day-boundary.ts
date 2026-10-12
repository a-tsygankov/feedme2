import { dateKeyOf, midnightMs } from "@feedme2/shared";

/** Device-local midnight; the fallback when the house's zone is unusable. */
function startOfLocalDay(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Epoch-ms of 00:00 on the house's calendar day containing nowMs (spec §1.4: "Today" means the same on every
 * device). The zone math lives in shared/ so the Reports bounds and the dashboard agree on what a day is.
 */
export function startOfDayInZone(nowMs: number, timeZone: string): number {
  // shared/ falls back to UTC for a bad zone; the dashboard keeps its device-local fallback (pinned by the test).
  if (!isValidZone(timeZone)) return startOfLocalDay(nowMs);
  return midnightMs(dateKeyOf(nowMs, timeZone), timeZone);
}

/**
 * Zone validity per spelling. Building an Intl.DateTimeFormat only to see whether it throws cost one per call, and the
 * dashboard calls this on every 30 s tick. Bounded like shared/'s zone caches: cleared when full, since a
 * house has one zone and only a hostile or buggy caller would cycle through many.
 */
const ZONE_CACHE_LIMIT = 64;
const zoneValidity = new Map<string, boolean>();
function isValidZone(timeZone: string): boolean {
  let ok = zoneValidity.get(timeZone);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
      ok = true;
    } catch {
      ok = false;
    }
    if (zoneValidity.size >= ZONE_CACHE_LIMIT) zoneValidity.clear();
    zoneValidity.set(timeZone, ok);
  }
  return ok;
}
