import type { ReportSummary } from "@feedme2/shared";
import { catLabel, formatDuration, formatTotal } from "../../lib/report-format.ts";
import type { ReportFilters } from "../../lib/report-filters.ts";

function Tile({ label, value, note, testId }: { label: string; value: string; note?: string | undefined; testId: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid={testId}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold text-slate-900">{value}</p>
      {note ? <p className="truncate text-xs text-slate-500">{note}</p> : null}
    </div>
  );
}

/** The five headline numbers. Interval stats are null with fewer than two feedings of one cat: a dash, never NaN. */
export function ReportTiles({ summary, unit }: { summary: ReportSummary; unit: ReportFilters["unit"] }) {
  const { totals } = summary;
  const gapCat = totals.longestGap ? summary.cats.find((c) => c.id === totals.longestGap!.catId) : undefined;
  return (
    <section className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Totals">
      <Tile label="Feedings" value={String(totals.feedings)} testId="tile-feedings" />
      <Tile label="Amount" value={formatTotal(totals.amountMg, unit, summary)} testId="tile-amount" />
      <Tile label="Cans" value={`${totals.cans.toFixed(2)} cans`} testId="tile-cans" />
      <Tile label="Mean interval" value={formatDuration(totals.meanIntervalSec)} testId="tile-mean-interval" />
      <Tile label="Longest gap" value={formatDuration(totals.longestGap?.sec ?? null)} note={gapCat ? catLabel(gapCat) : undefined} testId="tile-longest-gap" />
    </section>
  );
}
