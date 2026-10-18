/**
 * The unavailable message, wherever the user ends up.
 *
 * A failed scenario can navigate before it fails — "Open Settings"
 * starts on "/", not "/settings" — so a message rendered inside the
 * menu itself could land on a screen nobody is looking at. That was a
 * live bug when the menu was a Settings group; it is structural now
 * that the menu is a sheet the user opens and closes. Spec §10
 * requires the message to reach the user with a way back to the menu,
 * so this is rendered by HelpProvider at the app root, the same place
 * UpdateBar lives and for the same reason: whichever screen the user
 * happens to be standing on when this fires is the screen it has to
 * reach.
 *
 * Takes its state as props rather than calling `useHelp()` itself —
 * this file and HelpProvider.tsx would otherwise import each other,
 * and there is nothing here that the caller doesn't already have.
 *
 * Ported from gigsy. feedme2's Button has no `soft` variant or `size`
 * prop: "Back to Help" is the secondary button (the one way forward),
 * Close stays ghost, and both keep the app's 44px touch height.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "../../components/Button.tsx";
import { updateStore } from "../../lib/pwa-update-browser.ts";

export function HelpUnavailableBanner({
  message,
  onBackToHelp,
  onDismiss,
}: {
  message: string;
  onBackToHelp: () => void;
  onDismiss: () => void;
}) {
  const [rootInert, setRootInert] = useState(
    () => document.getElementById("root")?.hasAttribute("inert") ?? false,
  );
  useEffect(() => {
    const appRoot = document.getElementById("root");
    if (!appRoot) return;
    const observer = new MutationObserver(() => {
      setRootInert(appRoot.hasAttribute("inert"));
    });
    observer.observe(appRoot, { attributes: true, attributeFilter: ["inert"] });
    setRootInert(appRoot.hasAttribute("inert"));
    return () => observer.disconnect();
  }, []);
  const updateState = useSyncExternalStore(
    updateStore.subscribe,
    updateStore.getSnapshot,
    () => "idle",
  );
  if (rootInert) return null;
  const bottomClass = updateState === "ready"
    ? "bottom-[calc(3rem+env(safe-area-inset-bottom))]"
    : "bottom-0";
  return (
    <div
      // Not `status`: spec §10 treats this as a dead end the user must
      // back out of, not a routine progress update, so it should
      // interrupt the way an assistive-tech announcement of a failure
      // ought to.
      role="alert"
      data-testid="help-unavailable"
      // Same shell as UpdateBar, the app's other app-root notice — one
      // z-step above it (UpdateBar is z-50) because the two competing
      // for the same strip of screen is a real, if rare, possibility,
      // and whichever one the user was actively mid-action on should
      // win.
      // sky, like HelpSheet and the tour popover: this is help failing,
      // not the app failing, and the tint is what carries that. Kept at
      // /95 so it stays the same translucent scrim UpdateBar is.
      className={`fixed inset-x-0 ${bottomClass} z-[51] border-t border-sky-200 bg-sky-100/95
                 px-4 py-3 backdrop-blur pb-[calc(0.75rem+env(safe-area-inset-bottom))]`}
    >
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-slate-700">{message}</p>
        <Button
          variant="secondary"
          data-testid="help-unavailable-back"
          onClick={onBackToHelp}
        >
          Back to Help
        </Button>
        <Button
          variant="ghost"
          data-testid="help-unavailable-dismiss"
          onClick={onDismiss}
        >
          Close
        </Button>
      </div>
    </div>
  );
}
