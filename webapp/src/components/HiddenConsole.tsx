import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DebugLogsResponseSchema, type LogEntry } from "@feedme2/shared";
import { clientLogBuffer } from "../lib/logger.ts";
import { fetchTierVersions, type TierVersions } from "../lib/versions.ts";
import { LogList } from "./LogList.tsx";

/** Data access is injected so the component stays presentational. */
export interface ConsoleDataSource {
  getVersions(): Promise<TierVersions>;
  /** null = worker unreachable (vs [] = reachable but empty). */
  getWorkerLogs(limit: number): Promise<LogEntry[] | null>;
  getClientLogs(): LogEntry[];
}

export function makeConsoleDataSource(fetchFn: typeof fetch = fetch): ConsoleDataSource {
  return {
    getVersions: () => fetchTierVersions(fetchFn),
    getWorkerLogs: async (limit) => {
      try {
        const res = await fetchFn(`/api/debug/logs?limit=${limit}`);
        if (!res.ok) return null;
        const parsed = DebugLogsResponseSchema.safeParse(await res.json());
        return parsed.success ? parsed.data.entries : null;
      } catch {
        return null;
      }
    },
    getClientLogs: () => clientLogBuffer.toArray(),
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
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

interface Props {
  onClose: () => void;
  dataSource: ConsoleDataSource;
}

const WORKER_LOG_LIMIT = 100;

type WorkerFeed = { status: "loading" } | { status: "unreachable" } | { status: "ok"; entries: LogEntry[] };

/** The hidden debug console — opened by 3 taps on the logo. Every
 * remote value degrades to an explicit marker so it works offline. */
export function HiddenConsole({ onClose, dataSource }: Props) {
  const [versions, setVersions] = useState<TierVersions | null>(null);
  const [workerFeed, setWorkerFeed] = useState<WorkerFeed>({ status: "loading" });
  const [clientLogs, setClientLogs] = useState<LogEntry[]>([]);

  const refresh = useCallback(async () => {
    setClientLogs(dataSource.getClientLogs());
    const [v, w] = await Promise.all([dataSource.getVersions(), dataSource.getWorkerLogs(WORKER_LOG_LIMIT)]);
    setVersions(v);
    setWorkerFeed(w === null ? { status: "unreachable" } : { status: "ok", entries: w });
  }, [dataSource]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const unreachable = versions?.worker === null;

  return (
    <div
      data-testid="hidden-console"
      role="dialog"
      aria-label="Debug console"
      className="fixed inset-x-0 bottom-0 z-50 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-slate-300 bg-white p-4 shadow-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-800">Debug console</h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600">
            Refresh
          </button>
          <button type="button" data-testid="console-close" onClick={onClose} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600">
            Close
          </button>
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

      <Section title="Client logs">
        <div data-testid="client-logs">
          <LogList entries={clientLogs} emptyMessage="No client logs yet." />
        </div>
      </Section>

      <Section title="Worker logs">
        <div data-testid="worker-logs">
          {workerFeed.status === "loading" ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : workerFeed.status === "unreachable" ? (
            <p className="text-xs text-slate-500">Worker unreachable.</p>
          ) : (
            <LogList entries={workerFeed.entries} emptyMessage="No worker logs yet." />
          )}
        </div>
      </Section>
    </div>
  );
}
