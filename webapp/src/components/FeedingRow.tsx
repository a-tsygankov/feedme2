import { formatAmount, type Feeding, type HouseSettings } from "@feedme2/shared";
import { Button } from "./Button.tsx";

interface Props { feeding: Feeding; settings: HouseSettings; onEdit: () => void; onDelete: () => void }

export function FeedingRow({ feeding, settings, onEdit, onDelete }: Props) {
  const when = new Date(feeding.fedAt);
  return (
    <li className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2" data-testid="feeding-row" data-feeding-id={feeding.id}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">
          {formatAmount(feeding.amountMg, settings.foodUnit, settings.canSizeMg)}
          <span className="ml-2 text-xs text-slate-500">entered as {feeding.enteredValue} {feeding.enteredUnit}</span>
        </p>
        <p className="text-xs text-slate-500">{when.toLocaleString()} · {feeding.source}{feeding.note ? ` · ${feeding.note}` : ""}</p>
      </div>
      <Button variant="ghost" onClick={onEdit} data-testid="feeding-edit">Edit</Button>
      <Button variant="ghost" aria-label="Delete feeding" onClick={onDelete} data-testid="feeding-delete">✕</Button>
    </li>
  );
}
