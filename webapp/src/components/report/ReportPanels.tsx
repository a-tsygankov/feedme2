import type { ReportSummary } from "@feedme2/shared";
import { ACCENT, BarChart, type BarPoint, type Series } from "../charts/BarChart.tsx";
import { Heatmap } from "../charts/Heatmap.tsx";
import { catLabel, formatTotal, periodLabel } from "../../lib/report-format.ts";
import type { ReportFilters } from "../../lib/report-filters.ts";

export interface ReportPanelsProps {
  summary: ReportSummary;
  unit: ReportFilters["unit"];
  /** Opens a period; absent for hour buckets, which have nothing finer to open. */
  onSelect?: ((key: string) => void) | undefined;
}

/** The four charts, all from one summary. Bars are stacked by cat in the cat's own colour. */
export function ReportPanels({ summary, unit, onSelect }: ReportPanelsProps) {
  const series: Series[] = summary.cats.map((c) => ({ id: c.id, label: catLabel(c), color: c.color }));
  const points = (pick: "feedings" | "amountMg"): BarPoint[] =>
    summary.periods.map((p) => ({
      key: p.key,
      label: periodLabel(p.key, summary.bucket),
      values: Object.fromEntries(Object.entries(p.byCat).map(([id, v]) => [id, v[pick]])),
    }));
  const intervals: BarPoint[] = summary.intervals.map((b, i) => ({ key: `i${i}`, label: b.label, values: { n: b.count } }));
  const drill = onSelect ? { onSelect } : {};
  return (
    <section className="space-y-3" aria-label="Charts">
      <BarChart title="Feedings" series={series} points={points("feedings")} format={String} testId="report-chart-feedings" {...drill} />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" data-testid="report-legend" aria-label="Cats">
        {summary.cats.map((c) => (
          <li key={c.id} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} aria-hidden="true" />
            {catLabel(c)}
          </li>
        ))}
      </ul>
      <BarChart title="Amount" series={series} points={points("amountMg")} format={(mg) => formatTotal(mg, unit, summary)} testId="report-chart-amount" {...drill} />
      <BarChart
        title="Time between feedings" series={[{ id: "n", label: "Intervals", color: ACCENT }]} points={intervals}
        format={String} testId="report-chart-intervals"
      />
      <Heatmap title="By hour" cells={summary.heatmap} testId="report-chart-heatmap" />
    </section>
  );
}
