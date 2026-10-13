import { Logo } from "./Logo.tsx";
import { useConsole } from "./ConsoleProvider.tsx";
import { useHouse } from "../hooks/use-house.ts";
import { useHelp } from "../help/runtime/HelpProvider.tsx";
import { SyncBadge } from "./SyncBadge.tsx";

/** gigsy's header control: a 44px touch target around a 24px ring.
 *  `-my-2` gives back the height the target adds over the logo's line, so
 *  the sticky header is no taller than it was before help arrived. */
const HELP_CONTROL =
  "group -my-2 inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-xl " +
  "transition-colors hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500";
const HELP_GLYPH =
  "flex h-6 w-6 items-center justify-center rounded-full border border-slate-400 text-sm font-semibold " +
  "leading-none text-slate-500 transition-colors group-hover:border-slate-600 group-hover:text-slate-700";

export function AppHeader() {
  const { tapLogo } = useConsole();
  const house = useHouse();
  const { isOpen: helpOpen, openHelp, closeHelp } = useHelp();
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between bg-slate-50/90 px-4 py-3 backdrop-blur">
      <Logo onTap={tapLogo} />
      <div className="flex min-w-0 items-center gap-2">
        <SyncBadge />
        <span className="truncate text-sm text-slate-500" data-testid="header-house">{house.data?.name ?? ""}</span>
        {/* Every screen with this header (Dashboard via AppShell, CatPage, Reports, Settings) gets the same door into
            help. Toggles rather than only opening, as in gigsy: the natural way to dismiss a sheet you opened from a
            button is to press it again, and aria-expanded tells a screen reader what the second press will do. */}
        <button
          type="button"
          onClick={helpOpen ? closeHelp : openHelp}
          aria-label="Help"
          aria-expanded={helpOpen}
          title="Help"
          data-testid="help-link"
          className={HELP_CONTROL}
        >
          {/* A ring around the glyph, not a bare "?": punctuation floating in a header reads as a typo, a circled one
              reads as help. */}
          <span aria-hidden="true" className={HELP_GLYPH}>?</span>
        </button>
      </div>
    </header>
  );
}
