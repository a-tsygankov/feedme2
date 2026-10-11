import { useState } from "react";
import { formatAmount, hungerState, type Cat, type Feeding, type House, type HungerLevel } from "@feedme2/shared";
import { Link } from "react-router-dom";
import { LEVEL_LABELS, poseForLevel } from "../lib/pose.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { CatFigure } from "./CatFigure.tsx";
import { HungerRing } from "./HungerRing.tsx";
import { Button } from "./Button.tsx";

/**
 * "Starving · fed never" read as a contradiction. A cat that was never fed says so; the "fed" level already says
 * "Fed", so it does not repeat the word.
 */
export function statusText(level: HungerLevel, nowMs: number, lastFedAt: number | null): string {
  if (lastFedAt === null) return `${LEVEL_LABELS[level]} · Never fed`;
  const ago = relativeTime(nowMs, lastFedAt);
  return level === "fed" ? `Fed ${ago}` : `${LEVEL_LABELS[level]} · fed ${ago}`;
}

interface Props {
  cat: Cat;
  house: House;
  /** undefined while today's feedings are still loading: shown as "…", never as a false zero. */
  todays: Feeding[] | undefined;
  nowMs: number;
  /** Open the feed sheet for this cat. */
  onFeed: () => void;
  /** Spec §4.3: one tap logs the cat's default amount now. Rejects if it could not be queued. */
  onQuickFeed: () => Promise<void> | void;
}

export function CatCard({ cat, house, todays, nowMs, onFeed, onQuickFeed }: Props) {
  const state = hungerState(nowMs, cat.lastFedAt, cat.hungryAfterSec);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const unit = house.settings.foodUnit;
  const canSize = house.settings.canSizeMg;
  const hasDefault = !!cat.defaultAmountMg;

  async function primary() {
    if (!hasDefault) { onFeed(); return; }
    // Guard against a double-tap logging two feedings.
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try { await onQuickFeed(); } catch { setFailed(true); } finally { setBusy(false); }
  }

  const totalMg = todays?.reduce((a, f) => a + f.amountMg, 0) ?? 0;
  return (
    <article className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4" data-testid="cat-card" data-cat-id={cat.id} data-level={state.level}>
      <Link to={`/cats/${cat.id}`} aria-label={`${cat.name} details`}>
        <HungerRing ratio={state.ratio} level={state.level} size={104}>
          <CatFigure pose={poseForLevel(state.level, cat.avatarPose)} color={cat.color} size={72} label={cat.name} />
        </HungerRing>
      </Link>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold text-slate-900">{cat.name}</h3>
        <p className="text-sm text-slate-600" data-testid="cat-status">{statusText(state.level, nowMs, cat.lastFedAt)}</p>
        <p className="text-xs text-slate-500" data-testid="cat-today">
          {todays === undefined
            ? "Today: …"
            : `Today: ${todays.length} ${todays.length === 1 ? "feeding" : "feedings"}${todays.length ? ` · ${formatAmount(totalMg, unit, canSize)}` : ""}`}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button onClick={() => void primary()} disabled={busy} data-testid="cat-feed">
            Feed{hasDefault ? ` ${formatAmount(cat.defaultAmountMg!, unit, canSize)}` : ""}
          </Button>
          {/* With a default the primary button logs straight away, so a different amount or time needs its own way in. */}
          {hasDefault ? <Button variant="ghost" onClick={onFeed} aria-label={`Feed ${cat.name} a different amount or time`} data-testid="cat-feed-more">Other…</Button> : null}
        </div>
        {failed ? <p className="mt-1 text-xs text-red-600" role="alert" data-testid="cat-feed-error">Couldn't log the feeding. Try again.</p> : null}
      </div>
    </article>
  );
}
