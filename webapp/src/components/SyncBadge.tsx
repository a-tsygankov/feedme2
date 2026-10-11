import { useSyncExternalStore } from "react";
import { syncEngine } from "../lib/sync-engine.ts";

export function SyncBadge() {
  const s = useSyncExternalStore((l) => syncEngine.subscribe(l), () => syncEngine.getSnapshot(), () => syncEngine.getSnapshot());
  if (s.pending === 0) return null;
  const text = s.status === "offline" ? `${s.pending} to sync · offline` : s.status === "syncing" ? "syncing…" : `${s.pending} to sync`;
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800" data-testid="sync-badge">{text}</span>;
}
