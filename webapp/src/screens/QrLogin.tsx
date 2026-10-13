/**
 * /qr?deviceId=…&token=…: the landing a device's Login QR opens (spec §1.3, §4.1). The one-time token is exchanged for
 * ordinary house tokens, then the URL is replaced with "/" so Back and the history never hold it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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

export function QrLogin() {
  const { tapLogo } = useConsole();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Read once: after the exchange the URL is "/" and the params are gone.
  const [body] = useState<LoginQrBody | null>(() => {
    const parsed = LoginQrBodySchema.safeParse({ deviceId: params.get("deviceId"), token: params.get("token") });
    return parsed.success ? parsed.data : null;
  });
  const [failure, setFailure] = useState<Failure | null>(body ? null : "invalid");
  const [busy, setBusy] = useState(body !== null);
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
    if (!body || started.current) return;
    started.current = true;
    void exchange(body);
  }, [body, exchange]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-6" data-testid="qr-login">
      <header><Logo onTap={tapLogo} /></header>
      <section className="mt-10 space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Signing in from your device</h2>
        {failure ? (
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
