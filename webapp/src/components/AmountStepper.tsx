import { formatAmount, type FoodUnit, type StepSettings } from "@feedme2/shared";
import { stepAmount } from "../lib/amount-stepper.ts";

interface Props { mg: number; unit: FoodUnit; settings: StepSettings; onChange: (mg: number) => void }

export function AmountStepper({ mg, unit, settings, onChange }: Props) {
  return (
    <div className="flex items-center justify-center gap-4" data-testid="amount-stepper">
      <button type="button" aria-label="Less" data-testid="amount-dec" onClick={() => onChange(stepAmount(mg, -1, unit, settings))}
        className="h-12 w-12 rounded-full border border-slate-300 text-2xl text-slate-700">−</button>
      <span className="min-w-[7rem] text-center text-2xl font-semibold tabular-nums text-slate-900" data-testid="amount-value">
        {formatAmount(mg, unit, settings.canSizeMg)}
      </span>
      <button type="button" aria-label="More" data-testid="amount-inc" onClick={() => onChange(stepAmount(mg, +1, unit, settings))}
        className="h-12 w-12 rounded-full border border-slate-300 text-2xl text-slate-700">+</button>
    </div>
  );
}
