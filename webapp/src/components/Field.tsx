import type { InputHTMLAttributes, ReactNode } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
}

/** Label + input + optional error, the one text-input shape in the app. */
export function Field({ label, error, hint, id, ...input }: Props) {
  const inputId = id ?? `f-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <label htmlFor={inputId} className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        id={inputId}
        {...input}
        aria-invalid={error ? true : undefined}
        className="mt-1 block w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
      {error ? <span className="mt-1 block text-xs text-red-600" role="alert">{error}</span> : hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}
