/**
 * UTC offset of an IANA zone at an instant, in minutes east of UTC. The
 * device has no tz database: it renders local times from this number
 * (spec §1.4 "offset pushed to device") and re-reads it every sync.
 */
export function tzOffsetMin(timeZone: string, nowMs: number): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(nowMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return Math.round((asUtc - Math.floor(nowMs / 1000) * 1000) / 60_000);
  } catch {
    return 0;
  }
}
