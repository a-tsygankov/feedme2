import { useEffect, useState } from "react";

export const TICK_MS = 30_000;

/** Delay until the next multiple of `periodMs` on the wall clock, so ticks land on :00 and :30 and "5 m ago" flips on time. */
export function msToNextTick(nowMs: number, periodMs: number = TICK_MS): number {
  return periodMs - (nowMs % periodMs);
}

/**
 * Wall-clock "now" that re-renders on the 30 s grid. Timers are throttled or frozen while a PWA is backgrounded, so
 * coming back (visibilitychange/focus) refreshes immediately instead of showing a stale "fed 5 m ago".
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      clearTimeout(timer);
      timer = setTimeout(tick, msToNextTick(Date.now()));
    };
    timer = setTimeout(tick, msToNextTick(Date.now()));
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return now;
}
