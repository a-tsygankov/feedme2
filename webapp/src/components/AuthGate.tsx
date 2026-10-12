import { useSyncExternalStore, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { authStore } from "../lib/auth-store.ts";

export function useAuth() {
  // Module-level references: inline arrows would be a new subscribe function every render, resubscribing each time.
  return useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot);
}

/** The full in-app target, not just the pathname: the device's QR link is /settings?pair=123456#devices and the
 * code must still be there after the login detour. */
export function fromLocation(loc: { pathname: string; search: string; hash: string }): string {
  return `${loc.pathname}${loc.search}${loc.hash}`;
}

/** Only app-internal paths; "//host" would be protocol-relative. */
export function safeReturnPath(from: unknown): string {
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/";
}

/** Signed-out visitors land on /login; the intended path rides along. */
export function AuthGate() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status !== "signedIn") return <Navigate to="/login" replace state={{ from: fromLocation(location) }} />;
  return <Outlet />;
}

/** The inverse gate for /login and /setup: a signed-in user (including one who just signed in) goes on to
 * where they were headed, so a stale bookmark or the back button never shows them a sign-in form. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const from = (useLocation().state as { from?: unknown } | null)?.from;
  if (auth.status === "signedIn") {
    return <Navigate to={safeReturnPath(from)} replace />;
  }
  return <>{children}</>;
}
