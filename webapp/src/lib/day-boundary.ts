/** Device-local midnight; the fallback when the house's zone is unusable. */
function startOfLocalDay(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number }

function wallClock(ms: number, fmt: Intl.DateTimeFormat): Wall {
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}

/** Zone offset (ms east of UTC) at an instant. */
function offsetAt(ms: number, fmt: Intl.DateTimeFormat): number {
  const w = wallClock(ms, fmt);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * Epoch-ms of 00:00 on the calendar day that `nowMs` falls on in `timeZone` (the house's zone, not the phone's:
 * "Today" must mean the same thing on every device in the house). The offset is looked up at the candidate
 * midnight, not at `nowMs`, because a DST change can sit between the two.
 */
export function startOfDayInZone(nowMs: number, timeZone: string): number {
  let fmt: Intl.DateTimeFormat;
  try {
    // h23: the default hour cycle can print "24" for midnight in some engines.
    fmt = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  } catch {
    return startOfLocalDay(nowMs);
  }
  const w = wallClock(nowMs, fmt);
  const wallMidnightAsUtc = Date.UTC(w.y, w.mo - 1, w.d);
  // Two passes converge across a transition: the first uses now's offset, the second the offset at that guess.
  let guess = wallMidnightAsUtc - offsetAt(nowMs, fmt);
  guess = wallMidnightAsUtc - offsetAt(guess, fmt);
  return guess;
}
