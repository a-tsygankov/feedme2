import { startOfWeek, type ReportSummary } from "@feedme2/shared";
import { drillRowLabel, formatTotal, weekRowLabel } from "../../lib/report-format.ts";
import { drillTo, type ReportFilters } from "../../lib/report-filters.ts";

interface Row { key: string; label: string; feedings: number; amountMg: number; target: ReportFilters }

/**
 * One row per unit one level down: a month's weeks, a week's days, a custom range's chart periods. The drill uses
 * drillTo's default level (a day key in the month view opens its week), unlike the chart's bars, which open the bar.
 */
export function drillRows(summary: ReportSummary, f: ReportFilters): Row[] {
  if (f.range === "month") {
    const weeks = new Map<string, Row>();
    for (const p of summary.periods) {
      const monday = startOfWeek(p.key.slice(0, 10));
      const w = weeks.get(monday) ?? { key: monday, label: weekRowLabel(monday, f.from, f.to), feedings: 0, amountMg: 0, target: drillTo(f, monday) };
      w.feedings += p.feedings;
      w.amountMg += p.amountMg;
      weeks.set(monday, w);
    }
    return [...weeks.values()];
  }
  const bucket = f.range === "week" ? "day" : summary.bucket;
  return summary.periods.map((p) => ({
    key: p.key, label: drillRowLabel(p.key, bucket, f.from, f.to), feedings: p.feedings, amountMg: p.amountMg, target: drillTo(f, p.key),
  }));
}

export function DrillTable({ summary, f, onOpen }: { summary: ReportSummary; f: ReportFilters; onOpen: (next: ReportFilters) => void }) {
  const rows = drillRows(summary, f);
  return (
    <section aria-label="Breakdown">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 pb-1 text-xs text-slate-500" aria-hidden="true">
        <span>Period</span><span className="text-right">Feedings</span><span className="w-20 text-right">Amount</span>
      </div>
      <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white" data-testid="report-drill">
        {rows.map((r) => (
          <li key={r.key}>
            <button
              type="button" onClick={() => onOpen(r.target)} disabled={r.target === f} data-testid="drill-row"
              className="grid min-h-[44px] w-full grid-cols-[1fr_auto_auto] items-center gap-x-4 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 disabled:hover:bg-transparent"
            >
              <span>{r.label}</span>
              <span className="text-right tabular-nums">{r.feedings}</span>
              <span className="w-20 text-right tabular-nums">{formatTotal(r.amountMg, f.unit, summary)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
