import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { dateKeyOf, type House } from "@feedme2/shared";
import { AppHeader } from "../components/AppHeader.tsx";
import { Button } from "../components/Button.tsx";
import { TabBar } from "../components/TabBar.tsx";
import { DayFeedings } from "../components/report/DayFeedings.tsx";
import { DrillTable } from "../components/report/DrillTable.tsx";
import { ReportControls } from "../components/report/ReportControls.tsx";
import { ReportPanels } from "../components/report/ReportPanels.tsx";
import { ReportTiles } from "../components/report/ReportTiles.tsx";
import { useCats } from "../hooks/use-cats.ts";
import { useHouse } from "../hooks/use-house.ts";
import { useReport } from "../hooks/use-report.ts";
import { api, NetworkError } from "../lib/api-client.ts";
import { downloadBlob } from "../lib/download.ts";
import { drillLevel, drillTo, parseReportFilters, toSearchParams, type ReportFilters } from "../lib/report-filters.ts";

/** Which range a chart bar opens: the bar's own bucket, said explicitly (a day bar in the month view is a day). */
const BAR_LEVEL = { day: "day", week: "week", month: "month" } as const;

export function Reports() {
  const house = useHouse();
  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-24" data-testid="reports">
      <AppHeader />
      <main className="space-y-4 px-4">
        <h2 className="text-xl font-semibold text-slate-900">Reports</h2>
        {/* The filters need the house's zone for "today", so nothing below renders before the house does. */}
        {house.data ? <ReportBody house={house.data} /> : <p className="text-sm text-slate-500">Loading…</p>}
      </main>
      <TabBar />
    </div>
  );
}

function ReportBody({ house }: { house: House }) {
  const { settings } = house;
  const cats = useCats();
  const [params, setParams] = useSearchParams();
  // The house's today, not the phone's (Review Focus 2).
  const today = dateKeyOf(Date.now(), settings.timezone);
  const search = params.toString();
  // Keyed on the string: the params object is new on every render.
  const f = useMemo(() => parseReportFilters(new URLSearchParams(search), today), [search, today]);
  const report = useReport(f);
  const [csv, setCsv] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  // Push, not replace: Back walks up the drill-down one level at a time.
  const go = (next: ReportFilters) => setParams(toSearchParams(next), { replace: false });

  async function downloadCsv() {
    setCsv({ busy: true, error: null });
    try {
      const blob = await api.exportCsv({ from: f.from, to: f.to, ...(f.cat !== null ? { cat: f.cat } : {}) });
      downloadBlob(blob, `feedme2-${f.from}-${f.to}.csv`);
      setCsv({ busy: false, error: null });
    } catch (err) {
      setCsv({ busy: false, error: err instanceof NetworkError ? "The CSV needs a connection." : "Couldn't download the CSV." });
    }
  }

  const summary = report.data;
  const bucket = summary?.bucket;
  const onSelect = bucket && bucket !== "hour" ? (key: string) => go(drillTo(f, key, BAR_LEVEL[bucket])) : undefined;

  return (
    <>
      <ReportControls
        f={f} today={today} cats={cats.data ?? []} showUnit={settings.foodUnit !== "can"} onChange={go}
        onCsv={() => void downloadCsv()} csvBusy={csv.busy} csvError={csv.error}
      />
      {summary ? (
        <>
          {report.isError ? <p className="text-xs text-slate-500" role="status">Showing the last loaded report; couldn't refresh it.</p> : null}
          <ReportTiles summary={summary} unit={f.unit} />
          <ReportPanels summary={summary} unit={f.unit} onSelect={onSelect} />
          {drillLevel(f) === "feedings" ? <DayFeedings f={f} summary={summary} /> : <DrillTable summary={summary} f={f} onOpen={go} />}
        </>
      ) : report.isError ? (
        // Reports are online-only (spec §4.2): offline with nothing cached is a state, not an error.
        report.error instanceof NetworkError ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600" data-testid="report-offline">Reports need a connection.</p>
        ) : (
          <div className="space-y-2" data-testid="report-error">
            <p className="text-sm text-red-600" role="alert">Couldn't load the report.</p>
            <Button variant="secondary" onClick={() => void report.refetch()} disabled={report.isFetching}>Retry</Button>
          </div>
        )
      ) : (
        <div className="space-y-3" data-testid="report-loading" aria-busy="true" aria-label="Loading the report">
          <div className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-200" />)}</div>
          <div className="h-44 animate-pulse rounded-xl bg-slate-200" />
        </div>
      )}
    </>
  );
}
