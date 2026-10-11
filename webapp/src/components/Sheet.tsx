import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  /** False while a submit is in flight: Escape and the backdrop must not abandon it half-sent. Default true. */
  dismissable?: boolean;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet: the one modal surface in the app. Escape and backdrop close it.
 * Rendered in a portal on <body> so the app root can be made `inert` (nothing behind the sheet is reachable by
 * keyboard or screen reader), with focus moved in on open and restored on close, and the page behind scroll-locked.
 */
export function Sheet({ title, onClose, children, testId = "sheet", dismissable = true }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Refs, not effect deps: parents pass inline arrows, and re-binding the listener every render would also
  // re-run the focus management below.
  const onCloseRef = useRef(onClose);
  const dismissableRef = useRef(dismissable);
  onCloseRef.current = onClose;
  dismissableRef.current = dismissable;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && dismissableRef.current) onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    const wasInert = root?.hasAttribute("inert") ?? false;
    root?.setAttribute("inert", "");
    // Only undo what this instance did: another scroll lock may already be on the body, and removing it here would
    // unlock the page behind that owner.
    const addedLock = !document.body.classList.contains("overflow-hidden");
    if (addedLock) document.body.classList.add("overflow-hidden");
    const dialog = dialogRef.current;
    (dialog?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog)?.focus();
    return () => {
      if (!wasInert) root?.removeAttribute("inert");
      if (addedLock) document.body.classList.remove("overflow-hidden");
      previous?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-40" data-testid={testId}>
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-slate-900/40"
        onClick={() => { if (dismissable) onClose(); }} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl focus:outline-none">
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
