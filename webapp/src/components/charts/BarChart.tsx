import type { KeyboardEvent, ReactNode } from "react";
import { ChartFrame } from "./ChartFrame.tsx";

/** The single-series colour. A token, not a hex, so it follows data-theme like everything else. */
export const ACCENT = "rgb(var(--c-emerald-600))";

/** One stacked series; `color` is any CSS colour (a cat's hex, or ACCENT). */
export interface Series { id: string; label: string; color: string }
/** One column; `values` is keyed by `Series.id`, and a missing id counts as 0. */
export interface BarPoint { key: string; label: string; values: Record<string, number> }

export interface BarChartProps {
  title: string;
  series: Series[];
  points: BarPoint[];
  format: (n: number) => string;
  /** Set to make each column a drill-down button (click, Enter, Space). */
  onSelect?: (key: string) => void;
  height?: number;
  testId: string;
}

const COL = 12; // viewBox units per column
const BAR = 9; // bar width inside a column
const HEADROOM = 0.9; // the tallest column stops short of the top so it never reads as clipped

export function BarChart({ title, series, points, format, onSelect, height = 140, testId }: BarChartProps) {
  const totals = points.map((p) => series.reduce((a, s) => a + Math.max(0, p.values[s.id] ?? 0), 0));
  const max = Math.max(0, ...totals);
  // max 0 means nothing to draw; a 0 scale (not height / 0) keeps NaN and Infinity out of the markup.
  const scale = max > 0 ? (height * HEADROOM) / max : 0;
  // Axis labels are HTML, not SVG text: preserveAspectRatio="none" would stretch SVG glyphs with the plot.
  const every = Math.max(1, Math.ceil(points.length / 8));
  const table = {
    headers: ["", ...series.map((s) => s.label)],
    rows: points.map((p) => [p.label, ...series.map((s) => format(p.values[s.id] ?? 0))]),
  };
  const activate = (key: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault(); // Space would otherwise scroll the page
      onSelect?.(key);
    }
  };
  return (
    <ChartFrame title={title} empty={max === 0} table={table} testId={testId}>
      {/* Hidden from screen readers only when it is pure picture: drillable columns are buttons and must stay reachable. */}
      <svg
        viewBox={`0 0 ${points.length * COL} ${height}`}
        preserveAspectRatio="none"
        className="h-36 w-full"
        aria-hidden={onSelect ? undefined : true}
      >
        {points.map((p, i) => {
          let y = height;
          const rects: ReactNode[] = [];
          for (const s of series) {
            const v = p.values[s.id] ?? 0;
            if (v <= 0) continue;
            const h = v * scale;
            y -= h;
            rects.push(<rect key={s.id} x={i * COL + (COL - BAR) / 2} y={y} width={BAR} height={h} fill={s.color} rx={1.5} />);
          }
          const label = `${p.label}: ${format(totals[i]!)}`;
          return (
            <g
              key={p.key}
              data-testid={`bar-${p.key}`}
              {...(onSelect
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": label,
                    onClick: () => onSelect(p.key),
                    onKeyDown: activate(p.key),
                    className: "cursor-pointer outline-none focus-visible:opacity-70",
                  }
                : {})}
            >
              <title>{label}</title>
              {/* Full-height hit area so a short (or empty) column is still easy to tap. */}
              <rect x={i * COL} y={0} width={COL} height={height} fill="transparent" />
              {rects}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500" aria-hidden="true">
        {points.filter((_, i) => i % every === 0).map((p) => <span key={p.key}>{p.label}</span>)}
      </div>
    </ChartFrame>
  );
}
