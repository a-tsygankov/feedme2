import { useSyncExternalStore, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { authStore } from "../lib/auth-store.ts";

export function useAuth() {
  // Module-level references: inline arrows would be a new subscribe function every render, resubscribing each time.
  return useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot);
}

/** Signed-out visitors land on /login; the intended path rides along. */
export function AuthGate() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status !== "signedIn") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** The inverse gate for /login and /setup: a signed-in user (including one who just signed in) goes on to
 * where they were headed, so a stale bookmark or the back button never shows them a sign-in form. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const from = (useLocation().state as { from?: unknown } | null)?.from;
  if (auth.status === "signedIn") {
    // Only app-internal paths; "//host" would be protocol-relative.
    const to = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/";
    return <Navigate to={to} replace />;
  }
  return <>{children}</>;
}
