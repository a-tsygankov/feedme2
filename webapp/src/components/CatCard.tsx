import { formatAmount, hungerState, type Cat, type Feeding, type House } from "@feedme2/shared";
import { Link } from "react-router-dom";
import { poseForLevel } from "../lib/pose.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { CatFigure } from "./CatFigure.tsx";
import { HungerRing } from "./HungerRing.tsx";
import { Button } from "./Button.tsx";

const LABEL: Record<ReturnType<typeof hungerState>["level"], string> = {
  fed: "Just fed", content: "Content", peckish: "Peckish", hungry: "Hungry", very_hungry: "Very hungry", starving: "Starving",
};

interface Props { cat: Cat; house: House; todays: Feeding[]; nowMs: number; onFeed: () => void }

export function CatCard({ cat, house, todays, nowMs, onFeed }: Props) {
  const state = hungerState(nowMs, cat.lastFedAt, cat.hungryAfterSec);
  const totalMg = todays.reduce((a, f) => a + f.amountMg, 0);
  return (
    <article className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4" data-testid="cat-card" data-cat-id={cat.id} data-level={state.level}>
      <Link to={`/cats/${cat.id}`} aria-label={`${cat.name} details`}>
        <HungerRing ratio={state.ratio} level={state.level} size={104}>
          <CatFigure pose={poseForLevel(state.level, cat.avatarPose)} color={cat.color} size={72} title={cat.name} />
        </HungerRing>
      </Link>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold text-slate-900">{cat.name}</h3>
        <p className="text-sm text-slate-600" data-testid="cat-status">{LABEL[state.level]} · fed {relativeTime(nowMs, cat.lastFedAt)}</p>
        <p className="text-xs text-slate-500" data-testid="cat-today">
          Today: {todays.length} {todays.length === 1 ? "feeding" : "feedings"}{todays.length ? ` · ${formatAmount(totalMg, house.settings.foodUnit, house.settings.canSizeMg)}` : ""}
        </p>
        <Button className="mt-2" onClick={onFeed} data-testid="cat-feed">
          Feed{cat.defaultAmountMg ? ` ${formatAmount(cat.defaultAmountMg, house.settings.foodUnit, house.settings.canSizeMg)}` : ""}
        </Button>
      </div>
    </article>
  );
}
