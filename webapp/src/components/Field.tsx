import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
}

/** Label + input + optional error, the one text-input shape in the app. */
export function Field({ label, error, hint, id, className, "aria-describedby": describedBy, ...input }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const noteId = `${inputId}-note`;
  // The note is a sibling of the label (not inside it) so the input's accessible
  // name stays just the label text; aria-describedby announces the note after it.
  const describedByIds = [describedBy, error || hint ? noteId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div className="block">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">{label}</label>
      <input
        {...input}
        id={inputId}
        aria-describedby={describedByIds}
        aria-invalid={error ? true : undefined}
        className={cn(
          "mt-1 block w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500",
          className,
        )}
      />
      {error ? <p id={noteId} className="mt-1 text-xs text-red-600" role="alert">{error}</p> : hint ? <p id={noteId} className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
