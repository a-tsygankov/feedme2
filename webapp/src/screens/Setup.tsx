import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api-client.ts";
import { authStore } from "../lib/auth-store.ts";
import { Logo } from "../components/Logo.tsx";
import { useConsole } from "../components/ConsoleProvider.tsx";
import { Field } from "../components/Field.tsx";
import { Button } from "../components/Button.tsx";

export function Setup() {
  const { tapLogo } = useConsole();
  const navigate = useNavigate();
  const [houseName, setHouseName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pin !== pin2) { setError("PINs do not match."); return; }
    if (!/^\d{4,12}$/.test(pin)) { setError("PIN is 4 to 12 digits."); return; }
    setBusy(true);
    setError(null);
    try {
      authStore.applyTokens(await api.setup(houseName.trim(), pin));
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? "That house name is taken." : "Could not create the house. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-6" data-testid="setup">
      <header><Logo onTap={tapLogo} /></header>
      <form onSubmit={submit} className="mt-10 space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Create your house</h2>
        <Field label="House name" value={houseName} onChange={(e) => setHouseName(e.target.value)} minLength={2} maxLength={32} data-testid="setup-name" required hint="Everyone in the house shares it." />
        <Field label="PIN" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} data-testid="setup-pin" required />
        <Field label="PIN again" type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value)} data-testid="setup-pin2" required />
        {error ? <p className="text-sm text-red-600" role="alert" data-testid="setup-error">{error}</p> : null}
        <Button type="submit" disabled={busy} className="w-full" data-testid="setup-submit">Create house</Button>
        <p className="text-center text-sm text-slate-500">
          Already have one? <Link to="/login" className="text-emerald-700 underline">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
