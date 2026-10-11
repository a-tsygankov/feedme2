import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "danger" | "ghost";
const STYLES: Record<Variant, string> = {
  primary: "bg-emerald-600 text-on-accent hover:bg-accent-hover",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
  // text-on-accent, not text-white: the dark theme remaps white.
  danger: "bg-red-600 text-on-accent hover:bg-red-500",
  ghost: "text-slate-600 hover:bg-slate-100",
};

export function Button({ variant = "primary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "min-h-[44px] rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
        STYLES[variant],
        className,
      )}
    />
  );
}
