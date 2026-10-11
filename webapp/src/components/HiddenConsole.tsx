import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LogEntry, LogLevel, LogSource } from "@feedme2/shared";
import { api } from "../lib/api-client.ts";
import { authStore } from "../lib/auth-store.ts";
import { getClientId } from "../lib/client-id.ts";
import { clientLogBuffer } from "../lib/logger.ts";
import { fetchTierVersions, type TierVersions } from "../lib/versions.ts";
import { LogList } from "./LogList.tsx";

/** What the house's persisted feed gave back. "signedOut" is a skipped request, not a failure. */
export type RemoteFeed = { status: "signedOut" } | { status: "unreachable" } | { status: "ok"; entries: LogEntry[] };

/** Data access is injected so the component stays presentational. */
export interface ConsoleDataSource {
  getVersions(): Promise<TierVersions>;
  getRemoteLogs(): Promise<RemoteFeed>;
  /** This phone's ring buffer, newest first, each line stamped with this phone's client id. */
  getLocalLogs(): LogEntry[];
}

const REMOTE_LIMIT = 300;

export function makeConsoleDataSource(clientId: string = getClientId()): ConsoleDataSource {
  return {
    getVersions: () => fetchTierVersions(),
    getRemoteLogs: async () => {
      if (authStore.getSnapshot().status !== "signedIn") return { status: "signedOut" };
      try {
        return { status: "ok", entries: await api.debugLogs({ limit: REMOTE_LIMIT }) };
      } catch {
        return { status: "unreachable" };
      }
    },
    // Stamped so the copy this phone uploaded earlier (the server records the same clientId) merges away.
    getLocalLogs: () => clientLogBuffer.toArray().reverse().map((e) => ({ ...e, clientId })),
  };
}

const identity = (e: LogEntry) => `${e.ts}|${e.msg}|${e.clientId ?? ""}`;

/**
 * One feed from the local ring buffer and the house's server feed. This phone's own uploads come back from the
 * server too, so entries with the same (ts, msg, clientId) collapse to the first seen, which is the local copy.
 * Newest first; entries with equal ts keep their input order (local before remote), so the list does not
 * shuffle between refreshes.
 */
export function mergeFeeds(local: LogEntry[], remote: LogEntry[]): LogEntry[] {
  const seen = new Set<string>();
  const out: LogEntry[] = [];
  for (const e of [...local, ...remote]) {
    const key = identity(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => b.ts - a.ts); // Array.prototype.sort is stable
}

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const SOURCES: Array<LogSource | "all"> = ["all", "web", "worker", "device"];
export const LIVE_POLL_MS = 5000;

/** Calls `tick` every LIVE_POLL_MS unless the tab is hidden (a backgrounded phone must not keep polling). */
export function startLivePoll(tick: () => void, isHidden: () => boolean = () => document.hidden, intervalMs = LIVE_POLL_MS): () => void {
  const id = setInterval(() => { if (!isHidden()) tick(); }, intervalMs);
  return () => clearInterval(id);
}

export function filterEntries(entries: LogEntry[], f: { source: LogSource | "all"; minLevel: LogLevel; text: string }): LogEntry[] {
  const min = LEVELS.indexOf(f.minLevel);
  const q = f.text.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (f.source === "all" || e.source === f.source) &&
      LEVELS.indexOf(e.level) >= min &&
      (!q || `${e.msg} ${e.data ? JSON.stringify(e.data) : ""}`.toLowerCase().includes(q)),
  );
}

interface Props {
  onClose: () => void;
  dataSource: ConsoleDataSource;
}

/** The hidden debug console, opened by 3 taps on the logo. Every remote value degrades to an explicit marker so it
 * works offline and signed out. */
export function HiddenConsole({ onClose, dataSource }: Props) {
  const [versions, setVersions] = useState<TierVersions | null>(null);
  const [remote, setRemote] = useState<RemoteFeed | "loading">("loading");
  const [local, setLocal] = useState<LogEntry[]>([]);
  const [source, setSource] = useState<LogSource | "all">("all");
  const [minLevel, setMinLevel] = useState<LogLevel>("debug");
  const [text, setText] = useState("");
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  // A slow response must not overwrite a newer one, nor set state after the console closed.
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    setLocal(dataSource.getLocalLogs());
    const [v, r] = await Promise.all([dataSource.getVersions(), dataSource.getRemoteLogs()]);
    if (!mounted.current || mine !== generation.current) return;
    setVersions(v);
    setRemote(r);
  }, [dataSource]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => (live ? startLivePoll(() => void refresh()) : undefined), [live, refresh]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const merged = useMemo(() => mergeFeeds(local, remote !== "loading" && remote.status === "ok" ? remote.entries : []), [local, remote]);
  const visible = useMemo(() => filterEntries(merged, { source, minLevel, text }), [merged, source, minLevel, text]);

  const exportJson = () => JSON.stringify({ exportedAt: new Date().toISOString(), versions, entries: visible }, null, 2);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportJson());
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };
  const unreachable = versions?.worker === null;

  return (
    <div
      data-testid="hidden-console"
      role="dialog"
      aria-label="Debug console"
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-slate-300 bg-white shadow-2xl pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex items-center justify-between gap-2 p-3">
        <h2 className="text-sm font-bold text-slate-800">Debug console</h2>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Chip onClick={() => void refresh()} testId="console-refresh">Refresh</Chip>
          <Chip onClick={() => setLive((v) => !v)} pressed={live} testId="console-live">Live</Chip>
          <Chip onClick={() => void copy()} testId="console-copy">{copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy JSON"}</Chip>
          <Chip onClick={() => download(exportJson())} testId="console-download">Download JSON</Chip>
          <Chip onClick={onClose} testId="console-close">Close</Chip>
        </div>
      </div>

      <Section title="Versions">
        {versions === null ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : (
          <div className="space-y-0.5">
            <VersionRow tier="webapp" value={versions.client} testId="version-client" />
            <VersionRow tier="worker" value={versions.worker ?? "unreachable"} testId="version-worker" />
            <VersionRow tier="schema" value={versions.schema ?? (unreachable ? "unreachable" : "none applied")} testId="version-schema" />
            <VersionRow tier="firmware" value={versions.firmware ?? (unreachable ? "unreachable" : "no release")} testId="version-firmware" />
            <VersionRow tier="env" value={versions.env ?? "—"} testId="version-env" />
          </div>
        )}
      </Section>

      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3" data-testid="console-filters">
        {SOURCES.map((s) => (
          <Chip key={s} pressed={source === s} onClick={() => setSource(s)} testId={`filter-${s}`}>{s}</Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        {LEVELS.map((l) => (
          <Chip key={l} pressed={minLevel === l} onClick={() => setMinLevel(l)} testId={`level-${l}`}>{l === "debug" ? "all levels" : `${l}+`}</Chip>
        ))}
        <input
          aria-label="Search logs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="search"
          className="min-w-[8rem] flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
          data-testid="filter-text"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="console-feed">
        {remote === "loading" ? <p className="mb-2 text-xs text-slate-500">Loading server feed…</p> : null}
        {remote !== "loading" && remote.status === "signedOut" ? (
          <p className="mb-2 text-xs text-slate-500" data-testid="server-feed-unavailable">Signed out: the house feed is skipped. Showing this phone only.</p>
        ) : null}
        {remote !== "loading" && remote.status === "unreachable" ? (
          <p className="mb-2 text-xs text-slate-500" data-testid="server-feed-unavailable">Server feed unreachable (offline?). Showing this phone only.</p>
        ) : null}
        <LogList entries={visible} emptyMessage="Nothing matches." />
      </div>
    </div>
  );
}

function download(json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `feedme2-logs-${Date.now()}.json` });
  a.click();
  // Revoking in the same tick can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Chip({ children, onClick, pressed, testId }: { children: ReactNode; onClick: () => void; pressed?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      data-testid={testId}
      className={`rounded border px-2 py-1 text-xs ${pressed ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-white text-slate-600"}`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function VersionRow({ tier, value, testId }: { tier: string; value: string; testId: string }) {
  return (
    <div className="flex justify-between font-mono text-xs">
      <span className="text-slate-500">{tier}</span>
      <span data-testid={testId} className="text-slate-800">
        {value}
      </span>
    </div>
  );
}
