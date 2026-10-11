import type { ReactNode } from "react";
import { levelColor, type HungerLevel } from "@feedme2/shared";

interface Props {
  ratio: number;
  level: HungerLevel;
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
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const fill = Number.isFinite(ratio) ? Math.max(0, 1 - Math.min(ratio, 1)) : 0;
  const pulse = level === "starving" ? "animate-pulse" : "";
  return (
    <div className="relative" style={{ width: size, height: size }} data-testid="hunger-ring" data-level={level}>
      <svg width={size} height={size} className={`absolute inset-0 -rotate-90 ${pulse}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-default)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLOR[levelColor(level)]} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - fill)} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
