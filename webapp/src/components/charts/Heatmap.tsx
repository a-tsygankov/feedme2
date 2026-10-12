import { ACCENT, finite } from "./BarChart.tsx";
import { ChartFrame } from "./ChartFrame.tsx";

export interface HeatmapProps {
  title: string;
  /** 7 rows (Mon…Sun: weeks start on Monday) × 24 hours of feeding counts, in the house's zone. */
  cells: number[][];
  testId: string;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const CELL = 10;
const TICKS = [0, 6, 12, 18];

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** A weekday × hour grid. Opacity carries the count, so the only colour it needs is the accent token. */
export function Heatmap({ title, cells, testId }: HeatmapProps) {
  const at = (d: number, h: number) => finite(cells[d]?.[h]);
  const max = Math.max(0, ...DAYS.flatMap((_, d) => HOURS.map((h) => at(d, h))));
  // A zero cell's data rect is fully transparent (its track shows instead); any feeding gets at least 0.15 so a lone
  // one is still visible next to the peak. The floor was 0.08, which measured ~1.2:1 against the dark-mode card.
  const opacity = (n: number) => (n > 0 && max > 0 ? 0.15 + (0.85 * n) / max : 0);
  const table = {
    headers: ["", ...HOURS.map(String)],
    rows: DAYS.map((day, d) => [day, ...HOURS.map((h) => String(at(d, h)))]),
  };
  return (
    <ChartFrame title={title} empty={max === 0} table={table} testId={testId}>
      <div className="flex gap-1" aria-hidden="true">
        {/* The label column stretches to the SVG's height in 7 equal rows, so each label sits on its row of cells. */}
        <div className="grid grid-rows-7 text-[10px] leading-none text-slate-500">
          {DAYS.map((day) => <span key={day} className="flex items-center">{day}</span>)}
        </div>
        <div className="min-w-0 flex-1">
          <svg viewBox={`0 0 ${24 * CELL} ${7 * CELL}`} className="block h-auto w-full">
            {DAYS.map((day, d) =>
              HOURS.map((h) => (
                <g key={`${d}-${h}`}>
                  {/* The sunken track: without it empty hours vanish into the dark-mode card and the grid stops reading
                      as a grid. slate-200 is a step off the card in both themes (226/232/240 on white; 51/65/85 on
                      30/41/59). */}
                  <rect
                    data-track=""
                    x={h * CELL + 0.5} y={d * CELL + 0.5} width={CELL - 1} height={CELL - 1} rx={1.5}
                    fill="rgb(var(--c-slate-200))" fillOpacity={0.6}
                  />
                  <rect
                    x={h * CELL + 0.5} y={d * CELL + 0.5} width={CELL - 1} height={CELL - 1} rx={1.5}
                    fill={ACCENT} fillOpacity={opacity(at(d, h))}
                  >
                    <title>{`${day} ${hh(h)} – ${at(d, h)}`}</title>
                  </rect>
                </g>
              )),
            )}
          </svg>
          <div className="relative mt-1 h-3 text-[10px] leading-none text-slate-500">
            {TICKS.map((h) => <span key={h} className="absolute" style={{ left: `${(h / 24) * 100}%` }}>{h}</span>)}
          </div>
        </div>
      </div>
    </ChartFrame>
  );
}
