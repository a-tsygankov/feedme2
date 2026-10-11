import { useId, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface Props extends SelectHTMLAttributes<HTMLSelectElement> { label: string; options: Array<{ value: string; label: string }> }

/** Label + native select, the one dropdown shape in the app (a native select gets the phone's picker for free). */
export function Select({ label, options, id, className, ...rest }: Props) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className="block">
      <label htmlFor={selectId} className="text-sm font-medium text-slate-700">{label}</label>
      <select
        id={selectId}
        {...rest}
        className={cn("mt-1 block w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500", className)}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
