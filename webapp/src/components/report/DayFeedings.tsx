import { useQuery } from "@tanstack/react-query";
import { dayBoundsMs, type ReportSummary } from "@feedme2/shared";
import { Button } from "../Button.tsx";
import { api, NetworkError } from "../../lib/api-client.ts";
import { catLabel, clockTime, formatTotal } from "../../lib/report-format.ts";
import type { ReportFilters } from "../../lib/report-filters.ts";

const LIMIT = 200;

/** The bottom of the drill-down: one day's feedings, oldest first, at the house's wall-clock times. */
export function DayFeedings({ f, summary }: { f: ReportFilters; summary: ReportSummary }) {
  const tz = summary.timeZone;
  const { fromMs, toMs } = dayBoundsMs(f.from, f.from, tz);
  const q = useQuery({
    // Under "report", not "feedings": the dashboard rewrites that root expecting Feeding[].
    queryKey: ["report", "day-feedings", fromMs, toMs, f.cat],
    // The route's `to` is inclusive, hence - 1: the next day's first instant is not this day's.
    queryFn: () => api.listFeedings({ from: fromMs, to: toMs - 1, ...(f.cat !== null ? { cat: f.cat } : {}), limit: LIMIT }),
    staleTime: 60_000,
  });
  const names = new Map(summary.cats.map((c) => [c.id, catLabel(c)]));

  if (q.isPending) return <p className="text-sm text-slate-500">Loading feedings…</p>;
  if (q.isError) {
    if (q.error instanceof NetworkError) return <p className="text-sm text-slate-500" data-testid="day-feedings-offline">Feedings need a connection.</p>;
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-600" role="alert">Couldn't load the feedings.</p>
        <Button variant="secondary" onClick={() => void q.refetch()} disabled={q.isFetching}>Retry</Button>
      </div>
    );
  }
  // The API pages newest first; a day reads top to bottom.
  const items = [...q.data.items].reverse();
  if (items.length === 0) return <p className="text-sm text-slate-500" data-testid="day-feedings-empty">No feedings on this day.</p>;
  return (
    <section aria-label="Feedings">
      {q.data.nextCursor ? <p className="mb-2 text-xs text-slate-500">Showing the latest {LIMIT} feedings of this day.</p> : null}
      <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white" data-testid="day-feedings">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-3 px-3 py-2 text-sm text-slate-800" data-testid="day-feeding">
            <time dateTime={new Date(it.fedAt).toISOString()} className="tabular-nums text-slate-600">{clockTime(it.fedAt, tz)}</time>
            <span className="min-w-0 flex-1 truncate">{names.get(it.catId) ?? "Unknown cat"}</span>
            <span className="tabular-nums">{formatTotal(it.amountMg, f.unit, summary)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
