import { useSyncExternalStore } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { authStore } from "../lib/auth-store.ts";

export function useAuth() {
  return useSyncExternalStore((l) => authStore.subscribe(l), () => authStore.getSnapshot(), () => authStore.getSnapshot());
}

/** Signed-out visitors land on /login; the intended path rides along. */
export function AuthGate() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status !== "signedIn") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
