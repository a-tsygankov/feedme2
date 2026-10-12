import { Link } from "react-router-dom";
import { addDays, dateKeyOf, type Cat } from "@feedme2/shared";
import { Button } from "../Button.tsx";
import { BarChart, type BarPoint } from "../charts/BarChart.tsx";
import { useHouse } from "../../hooks/use-house.ts";
import { useReport } from "../../hooks/use-report.ts";
import { NetworkError } from "../../lib/api-client.ts";
import { formatDuration, formatTotal, periodLabel } from "../../lib/report-format.ts";
import { toSearchParams, type ReportFilters } from "../../lib/report-filters.ts";

const DAYS = 30;

function Tile({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2" data-testid={testId}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-semibold text-slate-900">{value}</p>
    </div>
  );
}

/**
 * The cat page's last 30 days: one custom-range report filtered to this cat, the same query (and cache entry) the
 * "Open in Reports" link lands on. Online-only like Reports; the history list below it keeps working offline.
 */
export function CatTrends({ cat }: { cat: Cat }) {
  const house = useHouse();
  // The house's today, not the phone's (Review Focus 2).
  const timeZone = house.data?.settings.timezone;
  if (!timeZone) return null;
  const today = dateKeyOf(Date.now(), timeZone);
  return <TrendsBody cat={cat} timeZone={timeZone} filters={{ range: "custom", from: addDays(today, -(DAYS - 1)), to: today, cat: cat.id, unit: "house" }} />;
}

function TrendsBody({ cat, timeZone, filters }: { cat: Cat; timeZone: string; filters: ReportFilters }) {
  const report = useReport(filters, timeZone);
  const summary = report.data;
  let body;
  if (summary) {
    const points: BarPoint[] = summary.periods.map((p) => ({ key: p.key, label: periodLabel(p.key, summary.bucket), values: { [cat.id]: p.amountMg } }));
    body = (
      <>
        <BarChart
          title="Amount per day" series={[{ id: cat.id, label: cat.name, color: cat.color }]} points={points}
          format={(mg) => formatTotal(mg, "house", summary)} height={100} testId="cat-trends-chart"
        />
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Feedings" value={String(summary.totals.feedings)} testId="trend-feedings" />
          <Tile label="Mean interval" value={formatDuration(summary.totals.meanIntervalSec)} testId="trend-mean-interval" />
          <Tile label="Longest gap" value={formatDuration(summary.totals.longestGap?.sec ?? null)} testId="trend-longest-gap" />
        </div>
      </>
    );
  } else if (report.error instanceof NetworkError) {
    body = <p className="text-sm text-slate-500" data-testid="cat-trends-offline">Trends need a connection.</p>;
  } else if (report.isError) {
    body = (
      <div className="flex items-center gap-2">
        <p className="text-sm text-red-600" role="alert">Couldn't load the trends.</p>
        <Button variant="secondary" onClick={() => void report.refetch()} disabled={report.isFetching}>Retry</Button>
      </div>
    );
  } else {
    body = <div className="h-32 animate-pulse rounded-xl bg-slate-100" aria-label="Loading trends" />;
  }
  return (
    <section className="space-y-2" data-testid="cat-trends" aria-label="Last 30 days">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-slate-700">Last 30 days</h3>
        <Link to={`/reports?${toSearchParams(filters)}`} className="text-sm text-emerald-700 underline" data-testid="cat-trends-link">Open in Reports</Link>
      </div>
      {body}
    </section>
  );
}
