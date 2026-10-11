import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError, NetworkError, api } from "../lib/api-client.ts";
import { authStore } from "../lib/auth-store.ts";
import { appLog } from "../lib/logger.ts";
import { Logo } from "../components/Logo.tsx";
import { useConsole } from "../components/ConsoleProvider.tsx";
import { Field } from "../components/Field.tsx";
import { Button } from "../components/Button.tsx";
import { PublicOnly } from "../components/AuthGate.tsx";

function loginError(err: unknown): string {
  if (err instanceof NetworkError) return "Check your connection";
  if (err instanceof ApiError && err.status === 400) return "Check the name and PIN format";
  if (err instanceof ApiError && err.status === 401) return "Wrong house or PIN";
  return "Something went wrong";
}

export function Login() {
  return <PublicOnly><LoginForm /></PublicOnly>;
}

function LoginForm() {
  const { tapLogo } = useConsole();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [houseName, setHouseName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      authStore.applyTokens(await api.login(houseName.trim(), pin));
      navigate(from, { replace: true });
    } catch (err) {
      setError(loginError(err));
      appLog.warn("login failed", { status: err instanceof ApiError ? err.status : err instanceof NetworkError ? "network" : "unknown" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-6" data-testid="login">
      <header><Logo onTap={tapLogo} /></header>
      <form onSubmit={submit} className="mt-10 space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Sign in to your house</h2>
        <Field label="House name" value={houseName} onChange={(e) => setHouseName(e.target.value)} autoComplete="username" autoCapitalize="off" autoCorrect="off" enterKeyHint="next" data-testid="login-name" required />
        <Field label="PIN" type="password" inputMode="numeric" pattern="\d{4,12}" maxLength={12} value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="current-password" data-testid="login-pin" required />
        {error ? <p className="text-sm text-red-600" role="alert" data-testid="login-error">{error}</p> : null}
        <Button type="submit" disabled={busy} className="w-full" data-testid="login-submit">Sign in</Button>
        <p className="text-center text-sm text-slate-500">
          New here? <Link to="/setup" className="text-emerald-700 underline" data-testid="login-to-setup">Create a house</Link>
        </p>
      </form>
    </div>
  );
}
