import { memo, useMemo } from "react";
import type { LogEntry } from "@feedme2/shared";

// Every text colour here is at least 4.5:1 on white (slate-600 is 7.6:1, slate-500 4.8:1): the console is read on a
// phone, outdoors, and the old slate-400 timestamps were 2.6:1.
const LEVEL_STYLES: Record<LogEntry["level"], string> = {
  debug: "text-slate-600",
  info: "text-slate-700",
  warn: "text-amber-700",
  error: "text-red-700",
};

interface Props {
  entries: LogEntry[];
  emptyMessage: string;
}

/**
 * Keys that survive a refresh. The old `ts-index` key re-keyed every row whenever a newer line arrived at the top, so
 * React re-mounted the whole list on each Live tick. Identical lines (same ts, source, msg, client) get a counter.
 */
export function rowKeys(entries: readonly LogEntry[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((e) => {
    const base = `${e.ts}|${e.source}|${e.msg}|${e.clientId ?? ""}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

/** Local entries are re-created (stamped with the client id) on each refresh; compare by content, not identity. */
const sameEntry = (a: { entry: LogEntry }, b: { entry: LogEntry }): boolean =>
  a.entry === b.entry ||
  (a.entry.ts === b.entry.ts && a.entry.source === b.entry.source && a.entry.level === b.entry.level &&
    a.entry.msg === b.entry.msg && a.entry.data === b.entry.data && a.entry.clientId === b.entry.clientId);

const LogRow = memo(function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <li className="flex gap-2" data-testid="log-entry" data-source={entry.source}>
      <span className="shrink-0 text-slate-600">{new Date(entry.ts).toLocaleTimeString()}</span>
      <span className="shrink-0 text-slate-600">{entry.source}</span>
      <span className={`shrink-0 uppercase ${LEVEL_STYLES[entry.level]}`}>{entry.level}</span>
      <span className="break-all text-slate-800">
        {entry.msg}
        {entry.data ? ` ${JSON.stringify(entry.data)}` : null}
      </span>
    </li>
  );
}, sameEntry);

/** One renderer for every feed: the shared LogEntry shape is the point. */
export function LogList({ entries, emptyMessage }: Props) {
  const keys = useMemo(() => rowKeys(entries), [entries]);
  if (entries.length === 0) {
    return <p className="text-xs text-slate-600">{emptyMessage}</p>;
  }
  return (
    <ul className="space-y-1 font-mono text-xs">
      {entries.map((entry, i) => <LogRow key={keys[i]} entry={entry} />)}
    </ul>
  );
}
