import { formatAmount, type Feeding, type HouseSettings } from "@feedme2/shared";
import { enteredAsText, formatFedAt } from "../lib/feeding-history.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { Button } from "./Button.tsx";

interface Props { feeding: Feeding; settings: HouseSettings; timeZone: string; onEdit: () => void; onDelete: () => void }

export function FeedingRow({ feeding, settings, timeZone, onEdit, onDelete }: Props) {
  // House timezone, not the phone's: two phones in different zones must read the same time.
  const absolute = formatFedAt(feeding.fedAt, timeZone);
  const entered = enteredAsText(feeding, settings.foodUnit);
  return (
    <li className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2" data-testid="feeding-row" data-feeding-id={feeding.id}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">
          {formatAmount(feeding.amountMg, settings.foodUnit, settings.canSizeMg)}
          {entered ? <span className="ml-2 text-xs text-slate-500">entered as {entered}</span> : null}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          {/* Relative reads faster; the exact time is the tooltip (and the machine-readable value). */}
          <time dateTime={new Date(feeding.fedAt).toISOString()} title={absolute}>{relativeTime(Date.now(), feeding.fedAt)}</time>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{feeding.source}</span>
        </p>
        {feeding.note ? <p className="break-words text-xs text-slate-500">{feeding.note}</p> : null}
      </div>
      <Button variant="ghost" onClick={onEdit} data-testid="feeding-edit">Edit</Button>
      <Button variant="ghost" aria-label="Delete feeding" onClick={onDelete} data-testid="feeding-delete">✕</Button>
    </li>
  );
}
