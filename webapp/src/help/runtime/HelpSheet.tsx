/**
 * The entry point into help: a bottom sheet wrapping HelpMenu, mounted
 * once at the app root (HelpProvider) so it works from any screen.
 *
 * Ported from gigsy, where "Send feedback" swaps the menu for a
 * FeedbackForm inside this same dialog. feedme2 has no feedback
 * endpoint, so the sheet has one face: the menu.
 *
 * Shape follows HiddenConsole (the app's only other bottom overlay):
 * fixed to the bottom, rounded top corners, its own scroll region,
 * safe-area padding. `z-50` — one below HelpUnavailableBanner's
 * `z-[51]`, so a failure message raised while this is open is never
 * covered by it.
 *
 * Modal in fact, not just in `aria-modal`: a full-screen backdrop at the
 * same z-50 sits under the sheet and takes every tap behind it, closing
 * help. Without it a cat's Feed button above the sheet stayed tappable,
 * the FeedSheet (portalled at z-40) opened UNDER help where it could not
 * be used, and one Escape closed both. The scrim is the house Sheet's
 * (`bg-slate-900/40`). #root is not made inert the way Sheet does it:
 * this sheet lives inside #root.
 *
 * Colour does NOT follow HiddenConsole. sky-100/sky-200 are the help
 * surface (--surface-help in src/styles/tokens/semantic.css); on the
 * card white every other panel uses, a sheet that slides up over the
 * screen it is explaining reads as part of that screen. Both steps are
 * tokenised, so the tint inverts with the theme instead of stranding a
 * pale blue sheet on a dark app.
 */
import { useEffect, useRef } from "react";
import { HelpMenu } from "./HelpMenu.tsx";

/** The dialog's id, for the header help button's `aria-controls`. */
export const HELP_SHEET_ID = "help-sheet";

export function HelpSheet({ onClose }: { onClose: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Spec §7.5 (gigsy's executable-help spec): help must be
  // keyboard-operable. HiddenConsole has no Escape handler to copy —
  // this is new, not borrowed.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Move focus into the sheet on open, without trapping it there
  // permanently — a real focus trap is more than this sheet needs, and
  // HiddenConsole doesn't have one either. On close (Escape, Close, the
  // backdrop, or the header button pressed again) focus goes back to
  // whatever had it, normally the header's help-link, as Sheet and
  // HiddenConsole do; otherwise it falls to <body>.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    return () => previous?.focus();
  }, []);

  return (
    <>
      {/* aria-hidden and not a button: Close is the sheet's one named
          dismiss control, and this layer is only there to swallow taps. */}
      <div
        aria-hidden="true"
        data-testid="help-sheet-backdrop"
        onClick={onClose}
        className="fixed inset-0 z-50 bg-slate-900/40"
      />
      <div
        id={HELP_SHEET_ID}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-sheet-heading"
        data-testid="help-sheet"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[75dvh] overflow-y-auto rounded-t-2xl
                   border-t border-sky-200 bg-sky-100 p-4 shadow-2xl
                   pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between">
          <h2
            id="help-sheet-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-sm font-bold text-slate-800 focus:outline-none"
          >
            Help
          </h2>
          <button
            type="button"
            data-testid="help-sheet-close"
            onClick={onClose}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
          >
            Close
          </button>
        </div>

        <HelpMenu />
      </div>
    </>
  );
}
