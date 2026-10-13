/**
 * /qr#deviceId=…&token=…: the landing a device's Login QR opens (spec §1.3, §4.1). The code rides in the fragment,
 * which no server log or Referer header ever sees (the older query form is still read). On mount the values move
 * into state and the URL becomes a bare /qr, BEFORE the exchange: a failed, offline or abandoned sign-in leaves no
 * live code in the address bar or history (security review, Phase 5a). A success then replaces /qr with "/".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LoginQrBodySchema, type LoginQrBody } from "@feedme2/shared";
import { ApiError, NetworkError, api } from "../lib/api-client.ts";
import { authStore } from "../lib/auth-store.ts";
import { appLog } from "../lib/logger.ts";
import { Logo } from "../components/Logo.tsx";
import { useConsole } from "../components/ConsoleProvider.tsx";
import { Button } from "../components/Button.tsx";

type Failure = "invalid" | "refused" | "offline" | "other";

const MESSAGES: Record<Failure, string> = {
  invalid: "This sign-in code isn't valid.",
  refused: "This sign-in code has expired or was already used. Show a new one on the device, or sign in with your PIN.",
  offline: "No connection. Try again when you're online.",
  other: "Something went wrong. Show a new code on the device, or sign in with your PIN.",
};

function failureOf(err: unknown): Failure {
  if (err instanceof NetworkError) return "offline";
  // The Worker answers every failed QR login with the same 401 so it is no oracle; a 400 means the code was mangled.
  if (err instanceof ApiError && err.status === 401) return "refused";
  if (err instanceof ApiError && err.status === 400) return "invalid";
  return "other";
}

/** The fragment form first; the query only when there is no fragment (links minted before the move). */
function readCode(hash: string, search: string): LoginQrBody | null {
  const params = new URLSearchParams(hash.length > 1 ? hash.slice(1) : search);
  const parsed = LoginQrBodySchema.safeParse({ deviceId: params.get("deviceId"), token: params.get("token") });
  return parsed.success ? parsed.data : null;
}

export function QrLogin() {
  const { tapLogo } = useConsole();
  const navigate = useNavigate();
  const location = useLocation();
  // Read once: the URL is scrubbed right after mount, and Retry works from state.
  const [body] = useState<LoginQrBody | null>(() => readCode(location.hash, location.search));
  // Read once too: a phone already in a house is asked before a QR (perhaps someone else's) moves it to another.
  const [signedInTo] = useState<string | null>(() => {
    const snap = authStore.getSnapshot();
    return snap.status === "signedIn" ? snap.house.name : null;
  });
  const [confirming, setConfirming] = useState(body !== null && signedInTo !== null);
  const [failure, setFailure] = useState<Failure | null>(body ? null : "invalid");
  const [busy, setBusy] = useState(body !== null && signedInTo === null);
  // StrictMode runs effects twice; a second exchange of a one-time token would always be refused.
  const started = useRef(false);

  const exchange = useCallback(async (b: LoginQrBody) => {
    setBusy(true);
    setFailure(null);
    try {
      // applyTokens replaces any session of another house; main.tsx's crossesSessionBoundary clears its cached data.
      authStore.applyTokens(await api.loginQr(b.deviceId, b.token));
      navigate("/", { replace: true });
    } catch (err) {
      setFailure(failureOf(err));
      // Never the token: only the outcome.
      appLog.warn("qr login failed", { status: err instanceof ApiError ? err.status : err instanceof NetworkError ? "network" : "unknown" });
    } finally {
      setBusy(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Replace, not push: the entry that carried the code is overwritten, so Back cannot return to it.
    if (location.search || location.hash) navigate("/qr", { replace: true });
    if (body && !confirming) void exchange(body);
    // Mount only: the scrub above changes location, and the exchange must not run again.
  }, []);

  const confirmSwitch = () => {
    if (!body) return;
    setConfirming(false);
    void exchange(body);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-6" data-testid="qr-login">
      <header><Logo onTap={tapLogo} /></header>
      <section className="mt-10 space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Signing in from your device</h2>
        {confirming ? (
          <>
            <p className="text-sm text-slate-700" data-testid="qr-login-confirm-text">
              {`You're signed in to ${signedInTo ?? ""}. Sign in to the device's house instead?`}
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => navigate("/", { replace: true })} data-testid="qr-login-cancel">Stay</Button>
              <Button className="flex-1" onClick={confirmSwitch} data-testid="qr-login-confirm">Switch</Button>
            </div>
          </>
        ) : failure ? (
          <>
            <p className="text-sm text-red-600" role="alert" data-testid="qr-login-error">{MESSAGES[failure]}</p>
            {failure === "offline" && body ? (
              <Button disabled={busy} className="w-full" onClick={() => void exchange(body)} data-testid="qr-login-retry">Retry</Button>
            ) : null}
            <p className="text-center text-sm text-slate-500">
              <Link to="/login" replace className="text-emerald-700 underline" data-testid="qr-login-to-login">Sign in with your PIN</Link>
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-600" role="status">Signing in…</p>
        )}
      </section>
    </div>
  );
}
