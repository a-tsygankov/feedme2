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

/** A bad aggregate (NaN, Infinity, a negative) draws as nothing: one NaN would make `max` NaN and every bar NaN. */
export const finite = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n > 0 ? n : 0);

export function BarChart({ title, series, points, format, onSelect, height = 140, testId }: BarChartProps) {
  const totals = points.map((p) => series.reduce((a, s) => a + finite(p.values[s.id]), 0));
  const max = Math.max(0, ...totals);
  // max 0 means nothing to draw; a 0 scale (not height / 0) keeps NaN and Infinity out of the markup.
  const scale = max > 0 ? (height * HEADROOM) / max : 0;
  // Axis labels are HTML, not SVG text: preserveAspectRatio="none" would stretch SVG glyphs with the plot.
  const every = Math.max(1, Math.ceil(points.length / 8));
  const table = {
    headers: ["", ...series.map((s) => s.label)],
    rows: points.map((p) => [p.label, ...series.map((s) => format(finite(p.values[s.id])))]),
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
        className="w-full"
        style={{ height }}
        {...(onSelect ? { role: "group", "aria-label": title } : { "aria-hidden": true })}
      >
        {points.map((p, i) => {
          let y = height;
          const rects: ReactNode[] = [];
          for (const s of series) {
            const v = finite(p.values[s.id]);
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
                    className: "group cursor-pointer outline-none",
                  }
                : {})}
            >
              <title>{label}</title>
              {/* Full-height hit area so a short (or empty) column is still easy to tap. It is also the focus indicator
                  (WCAG 2.4.7): the old focus-visible:opacity-70 dimmed the bars, so a zero column showed nothing. The
                  class fill beats the fill attribute; the stroke stays 1.5px under preserveAspectRatio="none". */}
              <rect
                x={i * COL} y={0} width={COL} height={height} fill="transparent"
                vectorEffect="non-scaling-stroke"
                className={onSelect ? "group-focus-visible:fill-slate-200 group-focus-visible:stroke-emerald-500 group-focus-visible:[stroke-width:1.5px]" : undefined}
              />
              {rects}
            </g>
          );
        })}
      </svg>
      {/* Each label is centred on its own column. justify-between spread them evenly instead, so in a 31-day month
          "29" sat under day 31. */}
      <div className="relative mt-1 h-3 text-[11px] leading-none text-slate-500" aria-hidden="true">
        {points.map((p, i) =>
          i % every === 0 ? (
            <span key={p.key} className="absolute -translate-x-1/2" style={{ left: `${((i + 0.5) / points.length) * 100}%` }}>
              {p.label}
            </span>
          ) : null,
        )}
      </div>
    </ChartFrame>
  );
}
