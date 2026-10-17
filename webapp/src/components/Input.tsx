import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** The bare text input, for a control whose label is not a visible line
 *  above it (help's search box names itself with aria-label). Field wraps
 *  this with a label, so the two cannot drift apart in look. */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "block w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500",
        className,
      )}
    />
  );
}
