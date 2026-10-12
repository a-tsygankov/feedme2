import { useRef, type KeyboardEvent } from "react";
import type { DateKey } from "@feedme2/shared";
import { Button } from "../Button.tsx";
import { Select } from "../Select.tsx";
import { parseReportFilters, rangeTitle, shiftRange, toSearchParams, type ReportFilters, type ReportRange } from "../../lib/report-filters.ts";

interface Option<T extends string> { value: T; label: string }

/** A segmented control as a radio group: one tab stop, arrows move the choice (the ARIA radio-group pattern). */
function Segmented<T extends string>({ label, value, options, onChange, testId }: {
  label: string; value: T; options: Option<T>[]; onChange: (v: T) => void; testId?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (i: number) => (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const j = (i + step + options.length) % options.length;
    onChange(options[j]!.value);
    refs.current[j]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId} className="flex rounded-xl bg-slate-100 p-1">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)} onKeyDown={onKey(i)}
            className={`min-h-[40px] flex-1 rounded-lg px-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${on ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const RANGES: Option<ReportRange>[] = [
  { value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "custom", label: "Custom" },
];
const UNITS: Option<ReportFilters["unit"]>[] = [{ value: "house", label: "House unit" }, { value: "can", label: "Cans" }];

/** Switching range keeps the place: today when it is inside the current range, else the range's first day. */
export function withRange(f: ReportFilters, range: ReportRange, today: DateKey): ReportFilters {
  if (range === "custom") return { ...f, range };
  const anchor = today >= f.from && today <= f.to ? today : f.from;
  return parseReportFilters(toSearchParams({ ...f, range, from: anchor }), today);
}

export interface ReportControlsProps {
  f: ReportFilters;
  today: DateKey;
  /** Live cats only: a removed cat is never offered (its feedings still show in "All cats"). */
  cats: { id: string; name: string }[];
  showUnit: boolean;
  onChange: (next: ReportFilters) => void;
  onCsv: () => void;
  csvBusy: boolean;
  csvError: string | null;
}

export function ReportControls({ f, today, cats, showUnit, onChange, onCsv, csvBusy, csvError }: ReportControlsProps) {
  const prev = shiftRange(f, -1);
  const next = shiftRange(f, 1);
  // A date input hands back "" while being cleared; a picked from after to (or to before from) moves the other end
  // with it instead of falling back to the default week.
  const setFrom = (v: string) => { if (v) onChange({ ...f, from: v, to: v > f.to ? v : f.to }); };
  const setTo = (v: string) => { if (v) onChange({ ...f, to: v, from: v < f.from ? v : f.from }); };
  const dateInput = "mt-1 block w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500";
  return (
    <section className="space-y-3" aria-label="Report filters">
      <Segmented label="Range" value={f.range} options={RANGES} onChange={(r) => onChange(withRange(f, r, today))} testId="report-range" />
      <div className="flex items-center gap-2">
        <Button variant="ghost" aria-label="Previous" disabled={prev === f} onClick={() => onChange(prev)} data-testid="report-prev">‹</Button>
        <p className="flex-1 text-center text-sm font-medium text-slate-800" data-testid="report-title" aria-live="polite">{rangeTitle(f)}</p>
        <Button variant="ghost" aria-label="Next" disabled={next === f} onClick={() => onChange(next)} data-testid="report-next">›</Button>
      </div>
      {f.range === "custom" ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium text-slate-700">From
            <input type="date" className={dateInput} value={f.from} min="2000-01-01" max="2999-12-31" onChange={(e) => setFrom(e.target.value)} data-testid="report-from" />
          </label>
          <label className="text-sm font-medium text-slate-700">To
            <input type="date" className={dateInput} value={f.to} min="2000-01-01" max="2999-12-31" onChange={(e) => setTo(e.target.value)} data-testid="report-to" />
          </label>
        </div>
      ) : null}
      {/* Never a selector with one option (spec §4.3). */}
      {cats.length >= 2 ? (
        <Select
          label="Cat" value={f.cat ?? ""} data-testid="report-cat" onChange={(e) => onChange({ ...f, cat: e.target.value || null })}
          options={[{ value: "", label: "All cats" }, ...cats.map((c) => ({ value: c.id, label: c.name }))]}
        />
      ) : null}
      {showUnit ? <Segmented label="Amounts in" value={f.unit} options={UNITS} onChange={(unit) => onChange({ ...f, unit })} testId="report-unit" /> : null}
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={onCsv} disabled={csvBusy} data-testid="report-csv">{csvBusy ? "Preparing…" : "Download CSV"}</Button>
        {csvError ? <p className="text-sm text-red-600" role="alert">{csvError}</p> : null}
      </div>
    </section>
  );
}
