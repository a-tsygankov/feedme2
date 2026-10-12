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
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    // shared/ falls back to UTC for a bad zone; the dashboard keeps its device-local fallback (pinned by the test).
    return startOfLocalDay(nowMs);
  }
  return midnightMs(dateKeyOf(nowMs, timeZone), timeZone);
}
