import { formatAmount, toMg, type FoodUnit, type StepSettings } from "@feedme2/shared";
import { canStep, stepAmount } from "../lib/amount-stepper.ts";

interface Props { mg: number; unit: FoodUnit; settings: StepSettings; onChange: (mg: number) => void }

/** Spec §4.3: cans are fed in fractions, so a tap on the common ones beats stepping there. */
const CAN_QUICK: Array<{ label: string; cans: number }> = [
  { label: "¼", cans: 0.25 }, { label: "½", cans: 0.5 }, { label: "¾", cans: 0.75 }, { label: "1", cans: 1 },
];

export function AmountStepper({ mg, unit, settings, onChange }: Props) {
  return (
    <div data-testid="amount-stepper">
      <div className="flex items-center justify-center gap-4">
        <button type="button" aria-label="Less" data-testid="amount-dec" disabled={!canStep(mg, -1, unit, settings)} onClick={() => onChange(stepAmount(mg, -1, unit, settings))}
          className="h-12 w-12 rounded-full border border-slate-300 text-2xl text-slate-700 disabled:opacity-40">−</button>
        <span className="min-w-[7rem] text-center text-2xl font-semibold tabular-nums text-slate-900" data-testid="amount-value" aria-live="polite">
          {formatAmount(mg, unit, settings.canSizeMg)}
        </span>
        <button type="button" aria-label="More" data-testid="amount-inc" disabled={!canStep(mg, +1, unit, settings)} onClick={() => onChange(stepAmount(mg, +1, unit, settings))}
          className="h-12 w-12 rounded-full border border-slate-300 text-2xl text-slate-700 disabled:opacity-40">+</button>
      </div>
      {unit === "can" ? (
        <div className="mt-3 flex justify-center gap-2" data-testid="amount-quick">
          {CAN_QUICK.map(({ label, cans }) => {
            const value = toMg(cans, "can", settings.canSizeMg);
            return (
              <button key={label} type="button" aria-label={`${label} can`} aria-pressed={mg === value} onClick={() => onChange(value)}
                className={`min-h-[44px] min-w-[44px] rounded-full border px-3 text-base ${mg === value ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-300 text-slate-600"}`}>
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
