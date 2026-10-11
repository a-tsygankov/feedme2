import { useEffect, useState, useSyncExternalStore } from "react";
import { syncEngine, type SyncEngine } from "../lib/sync-engine.ts";

/**
 * The live region is always in the DOM: a region that appears together with its text is often not announced, so only
 * its content comes and goes. An "error" stop is a button because waiting for the retry timer is not the only option.
 */
export function SyncBadge({ engine = syncEngine }: { engine?: Pick<SyncEngine, "subscribe" | "getSnapshot" | "drain"> }) {
  const s = useSyncExternalStore((l) => engine.subscribe(l), () => engine.getSnapshot(), () => engine.getSnapshot());
  const pill = "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800";
  let content = null;
  if (s.pending > 0) {
    if (s.status === "error") {
      content = <button type="button" className={`${pill} underline`} onClick={() => void engine.drain()} data-testid="sync-badge">sync problem · tap to retry</button>;
    } else {
      const text = s.status === "offline" ? `${s.pending} to sync · offline` : s.status === "syncing" ? "syncing…" : `${s.pending} to sync`;
      content = <span className={pill} data-testid="sync-badge">{text}</span>;
    }
  }
  return <span role="status" aria-live="polite" data-testid="sync-status">{content}</span>;
}

/**
 * Feedings the server refused (or gave up on after too many tries) are gone from the queue: say so, once, until
 * dismissed. Subscribes on its own so the count survives screen changes.
 */
export function SyncDroppedBanner({ engine = syncEngine }: { engine?: Pick<SyncEngine, "onDrained"> }) {
  const [count, setCount] = useState(0);
  useEffect(() => engine.onDrained((r) => { if (r.dropped.length > 0) setCount((c) => c + r.dropped.length); }), [engine]);
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-20 z-30 mx-auto flex max-w-lg items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 shadow" role="alert" data-testid="sync-dropped">
      <span>{count === 1 ? "1 feeding change couldn't be saved" : `${count} feeding changes couldn't be saved`}</span>
      <button type="button" className="min-h-[44px] px-2 underline" onClick={() => setCount(0)} aria-label="Dismiss">Dismiss</button>
    </div>
  );
}
