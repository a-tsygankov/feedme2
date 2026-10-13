import type { ReactNode } from "react";

export interface ChartTable { headers: string[]; rows: string[][] }

export interface ChartFrameProps {
  title: string;
  empty: boolean;
  emptyText?: string;
  table: ChartTable;
  children: ReactNode;
  testId: string;
}

/**
 * The shell every chart shares: a captioned figure, an empty state instead of a plot of zeros, and a visually hidden
 * data table. The plot itself is aria-hidden, so the table is how a screen reader gets the numbers.
 */
export function ChartFrame({ title, empty, emptyText = "No feedings in this range", table, children, testId }: ChartFrameProps) {
  return (
    <figure data-testid={testId} className="rounded-xl border border-slate-200 bg-white p-3">
      <figcaption className="mb-2 text-sm font-medium text-slate-700">{title}</figcaption>
      {empty ? <p className="py-8 text-center text-sm text-slate-500">{emptyText}</p> : children}
      {/* The box is hidden, not the table: a table sizes to its content and ignores sr-only's width:1px, which widened
          the page past the phone's width (2026-10-12, PR #4 CI). */}
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>{table.headers.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
