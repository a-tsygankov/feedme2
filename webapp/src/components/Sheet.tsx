import { useEffect, type ReactNode } from "react";

interface Props { title: string; onClose: () => void; children: ReactNode; testId?: string }

/** Bottom sheet: the one modal surface in the app. Escape and backdrop close it. */
export function Sheet({ title, onClose, children, testId = "sheet" }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40" data-testid={testId}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div role="dialog" aria-label={title} className="absolute inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
