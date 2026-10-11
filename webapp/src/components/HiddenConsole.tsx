import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DebugLogsQuery, LogEntry, LogLevel, LogSource } from "@feedme2/shared";
import { api } from "../lib/api-client.ts";
import { authStore } from "../lib/auth-store.ts";
import { getClientId } from "../lib/client-id.ts";
import { clientLogBuffer } from "../lib/logger.ts";
import { fetchTierVersions, type TierVersions } from "../lib/versions.ts";
import { LogList } from "./LogList.tsx";

/** What the house's persisted feed gave back. "signedOut" is a skipped request, not a failure. */
export type RemoteFeed = { status: "signedOut" } | { status: "unreachable" } | { status: "ok"; entries: LogEntry[] };

/** The part of the console's filters that the server can apply. The text filter is local only. */
export interface RemoteFilter {
  source: LogSource | "all";
  /** Minimum level; "debug" means everything. */
  minLevel: LogLevel;
  /** Device id (firmware lines); empty means any. */
  device: string;
}

/** Data access is injected so the component stays presentational. */
export interface ConsoleDataSource {
  getVersions(): Promise<TierVersions>;
  getRemoteLogs(filter: RemoteFilter): Promise<RemoteFeed>;
  /** This phone's ring buffer, newest first, each line stamped with this phone's client id. */
  getLocalLogs(): LogEntry[];
}

const REMOTE_LIMIT = 300;
const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const SOURCES: Array<LogSource | "all"> = ["all", "web", "worker", "device"];
export const LIVE_POLL_MS = 5000;
export const TEXT_DEBOUNCE_MS = 300;

interface SourceDeps {
  debugLogs(q: Partial<DebugLogsQuery>): Promise<LogEntry[]>;
  isSignedIn(): boolean;
}

const defaultDeps: SourceDeps = {
  debugLogs: (q) => api.debugLogs(q),
  isSignedIn: () => authStore.getSnapshot().status === "signedIn",
};

export function makeConsoleDataSource(clientId: string = getClientId(), deps: SourceDeps = defaultDeps): ConsoleDataSource {
  return {
    getVersions: () => fetchTierVersions(),
    getRemoteLogs: async (f) => {
      if (!deps.isSignedIn()) return { status: "signedOut" };
      const device = f.device.trim();
      const base: Partial<DebugLogsQuery> = { limit: REMOTE_LIMIT, ...(f.source !== "all" ? { source: f.source } : {}), ...(device ? { device } : {}) };
      // The server's `level` is an exact match, not a minimum, so "warn+" is one request per level at or above it. With
      // the level left to the client, 300 debug lines would push every error out of the window.
      const levels: Array<LogLevel | undefined> = f.minLevel === "debug" ? [undefined] : LEVELS.slice(LEVELS.indexOf(f.minLevel));
      try {
        const lists = await Promise.all(levels.map((level) => deps.debugLogs({ ...base, ...(level ? { level } : {}) })));
        const entries = lists.length === 1 ? lists[0]! : lists.flat().sort((a, b) => b.ts - a.ts).slice(0, REMOTE_LIMIT);
        return { status: "ok", entries };
      } catch {
        return { status: "unreachable" };
      }
    },
    // Stamped so the copy this phone uploaded earlier (the server records the same clientId) merges away.
    getLocalLogs: () => clientLogBuffer.toArray().reverse().map((e) => ({ ...e, clientId })),
  };
}

// The server stores msg capped at 500, so a longer local line must compare equal to its uploaded copy. Source and
// level are part of the identity: two different lines can share a ts and a message.
const MSG_KEY = 500;
const identity = (e: LogEntry) => `${e.ts}|${e.source}|${e.level}|${e.msg.slice(0, MSG_KEY)}|${e.clientId ?? ""}`;

/**
 * One feed from the local ring buffer and the house's server feed. This phone's own uploads come back from the
 * server too, so entries with the same (ts, source, level, msg[0..500], clientId) collapse to the first seen, which
 * is the local copy. Newest first; entries with equal ts keep their input order (local before remote), so the list
 * does not shuffle between refreshes.
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

/** Calls `tick` every LIVE_POLL_MS unless the tab is hidden (a backgrounded phone must not keep polling). */
export function startLivePoll(tick: () => void, isHidden: () => boolean = () => document.hidden, intervalMs = LIVE_POLL_MS): () => void {
  const id = setInterval(() => { if (!isHidden()) tick(); }, intervalMs);
  return () => clearInterval(id);
}

export function filterEntries(entries: LogEntry[], f: { source: LogSource | "all"; minLevel: LogLevel; text: string; device?: string }): LogEntry[] {
  const min = LEVELS.indexOf(f.minLevel);
  const q = f.text.trim().toLowerCase();
  const device = f.device?.trim() ?? "";
  return entries.filter(
    (e) =>
      (f.source === "all" || e.source === f.source) &&
      LEVELS.indexOf(e.level) >= min &&
      (!device || e.deviceId === device) &&
      (!q || `${e.msg} ${e.data ? JSON.stringify(e.data) : ""}`.toLowerCase().includes(q)),
  );
}

/** A value that follows `value` after it has been still for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const [device, setDevice] = useState("");
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  // Typing in the text box filters locally; debouncing keeps a phone from re-filtering 500 rows per keystroke. The
  // device id is part of the server query, so it is debounced for the same reason plus request spam.
  const debouncedText = useDebounced(text, TEXT_DEBOUNCE_MS);
  const debouncedDevice = useDebounced(device, TEXT_DEBOUNCE_MS);
  const dialogRef = useRef<HTMLDivElement>(null);
  // A slow response must not overwrite a newer one, nor set state after the console closed.
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Versions are four small requests and do not change while the console is open: once per open, and on Refresh.
  const loadVersions = useCallback(async () => {
    const v = await dataSource.getVersions();
    if (mounted.current) setVersions(v);
  }, [dataSource]);

  // The log feed depends on the server-side filters, so it refetches when they change (and on Live ticks / Refresh).
  const loadLogs = useCallback(async () => {
    const mine = ++generation.current;
    setLocal(dataSource.getLocalLogs());
    const r = await dataSource.getRemoteLogs({ source, minLevel, device: debouncedDevice });
    if (!mounted.current || mine !== generation.current) return;
    setRemote(r);
  }, [dataSource, source, minLevel, debouncedDevice]);

  useEffect(() => { void loadVersions(); }, [loadVersions]);
  useEffect(() => { void loadLogs(); }, [loadLogs]);
  useEffect(() => (live ? startLivePoll(() => void loadLogs()) : undefined), [live, loadLogs]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Same modal contract as Sheet: nothing behind is reachable (the app root goes inert, which is why this renders in a
  // portal), focus moves in on open and returns to what had it on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    const wasInert = root?.hasAttribute("inert") ?? false;
    root?.setAttribute("inert", "");
    const dialog = dialogRef.current;
    (dialog?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog)?.focus();
    return () => {
      if (!wasInert) root?.removeAttribute("inert");
      previous?.focus();
    };
  }, []);

  const merged = useMemo(() => mergeFeeds(local, remote !== "loading" && remote.status === "ok" ? remote.entries : []), [local, remote]);
  const visible = useMemo(
    () => filterEntries(merged, { source, minLevel, text: debouncedText, device: source === "device" ? debouncedDevice : "" }),
    [merged, source, minLevel, debouncedText, debouncedDevice],
  );

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

  return createPortal(
    <div className="fixed inset-0 z-50" data-testid="console-root">
      <div aria-hidden="true" className="absolute inset-0 bg-slate-900/40" data-testid="console-backdrop" onClick={onClose} />
      <div
        ref={dialogRef}
        data-testid="hidden-console"
        role="dialog"
        aria-modal="true"
        aria-label="Debug console"
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-slate-300 bg-white shadow-2xl pb-[env(safe-area-inset-bottom)] focus:outline-none"
      >
        <div className="flex items-center justify-between gap-2 p-3">
          <h2 className="text-sm font-bold text-slate-800">Debug console</h2>
          <div className="flex flex-wrap justify-end gap-1.5">
            <Chip onClick={() => { void loadVersions(); void loadLogs(); }} testId="console-refresh">Refresh</Chip>
            <Chip onClick={() => setLive((v) => !v)} pressed={live} testId="console-live">Live</Chip>
            <Chip onClick={() => void copy()} testId="console-copy">{copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy (filtered)"}</Chip>
            <Chip onClick={() => void downloadJson(exportJson())} testId="console-download">Download (filtered)</Chip>
            <Chip onClick={onClose} testId="console-close">Close</Chip>
          </div>
        </div>

        <Section title="Versions">
          {versions === null ? (
            <p className="text-xs text-slate-600">Loading…</p>
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
          {source === "device" ? (
            <input
              aria-label="Device id"
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              placeholder="device id"
              maxLength={64}
              className="min-h-[44px] min-w-[8rem] flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
              data-testid="filter-device-id"
            />
          ) : null}
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
            className="min-h-[44px] min-w-[8rem] flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
            data-testid="filter-text"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="console-feed">
          {remote === "loading" ? <p className="mb-2 text-xs text-slate-600">Loading server feed…</p> : null}
          {remote !== "loading" && remote.status === "signedOut" ? (
            <p className="mb-2 text-xs text-slate-600" data-testid="server-feed-unavailable">Signed out: the house feed is skipped. Showing this phone only.</p>
          ) : null}
          {remote !== "loading" && remote.status === "unreachable" ? (
            <p className="mb-2 text-xs text-slate-600" data-testid="server-feed-unavailable">Server feed unreachable (offline?). Showing this phone only.</p>
          ) : null}
          <LogList entries={visible} emptyMessage="Nothing matches." />
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface ShareEnv {
  /** A touch phone: where the system share sheet is the way to save a file (iOS standalone PWAs ignore `download`). */
  coarsePointer: boolean;
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  anchorDownload: (blob: Blob, filename: string) => void;
}

function browserShareEnv(): ShareEnv {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  return {
    coarsePointer: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
    ...(typeof nav.share === "function" ? { share: (d: ShareData) => nav.share(d) } : {}),
    ...(typeof nav.canShare === "function" ? { canShare: (d: ShareData) => nav.canShare!(d) } : {}),
    anchorDownload,
  };
}

function anchorDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  // Revoking in the same tick can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save the export: through the system share sheet on a phone that can share files, otherwise as a download. */
export async function downloadJson(json: string, env: ShareEnv = browserShareEnv(), now: () => number = Date.now): Promise<void> {
  const filename = `feedme2-logs-${now()}.json`;
  const blob = new Blob([json], { type: "application/json" });
  if (env.coarsePointer && env.share && env.canShare) {
    const file = new File([blob], filename, { type: "application/json" });
    if (env.canShare({ files: [file] })) {
      try {
        await env.share({ files: [file], title: filename });
        return;
      } catch (err) {
        if ((err as { name?: unknown } | null)?.name === "AbortError") return; // the person dismissed the sheet
        // Any other failure: fall through to the plain download.
      }
    }
  }
  env.anchorDownload(blob, filename);
}

function Chip({ children, onClick, pressed, testId }: { children: ReactNode; onClick: () => void; pressed?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      data-testid={testId}
      className={`min-h-[44px] rounded border px-3 py-1 text-xs ${pressed ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"}`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function VersionRow({ tier, value, testId }: { tier: string; value: string; testId: string }) {
  return (
    <div className="flex justify-between font-mono text-xs">
      <span className="text-slate-600">{tier}</span>
      <span data-testid={testId} className="text-slate-800">
        {value}
      </span>
    </div>
  );
}
