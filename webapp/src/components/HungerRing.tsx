import type { ReactNode } from "react";
import { levelColor, type HungerLevel } from "@feedme2/shared";
import { LEVEL_LABELS } from "../lib/pose.ts";

interface Props {
  /** elapsed / hungry-after; 0 = just fed, >= 1 = overdue. Non-finite renders empty. */
  ratio: number;
  level: HungerLevel;
  /** Outer diameter in CSS px. */
  size?: number;
  children?: ReactNode;
}

const COLOR: Record<ReturnType<typeof levelColor>, string> = {
  good: "var(--good-text)",
  warn: "var(--warn-value)",
  danger: "var(--danger-text)",
};

/** A ring that empties as the cat gets hungrier; full = just fed. */
export function HungerRing({ ratio, level, size = 120, children }: Props) {
  const stroke = Math.max(3, Math.round(size / 15));
  const r = (size - stroke) / 2;
  const fill = Number.isFinite(ratio) ? Math.min(1, Math.max(0, 1 - ratio)) : 0;
  const starving = level === "starving";
  return (
    <div className="relative" style={{ width: size, height: size }} data-testid="hunger-ring" data-level={level}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" role="img" aria-label={LEVEL_LABELS[level]}>
        {/* Incident: the pulse used to sit on the progress arc, but starving means ratio >= 1.5, so fill is 0 and that arc
            is never drawn: the "pulsing" ring never pulsed. The pulse lives on the always-drawn track instead, in the
            danger colour so an empty ring still reads as an alarm. A continuous pulse intentionally exceeds the 200 ms
            motion rule; motion-safe honours prefers-reduced-motion. */}
        <circle
          data-testid="hunger-ring-track"
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={starving ? COLOR.danger : "var(--border-default)"} strokeWidth={stroke}
          className={starving ? "motion-safe:animate-pulse" : undefined}
        />
        {/* Not drawn at fill 0: a round cap on a zero-length dash still paints a dot, which would read as "a little left". */}
        {fill > 0 ? (
          <circle
            data-testid="hunger-ring-progress"
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLOR[levelColor(level)]} strokeWidth={stroke}
            strokeLinecap="round"
            // pathLength normalises the circumference to 1, so the offset is just the unfilled share.
            pathLength={1} strokeDasharray="1" strokeDashoffset={1 - fill}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
