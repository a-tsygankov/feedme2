import { Logo } from "../components/Logo.tsx";
import { useConsole } from "../components/ConsoleProvider.tsx";
import { CLIENT_VERSION } from "../lib/versions.ts";

/** Phase 0 placeholder for the dashboard. Proves the shell, theme,
 * PWA and console plumbing end to end; Phase 1 replaces the body. */
export function Shell() {
  const { tapLogo } = useConsole();
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-6" data-testid="shell">
      <header className="flex items-center justify-between">
        <Logo onTap={tapLogo} />
        <span className="font-mono text-xs text-slate-500" data-testid="shell-version">
          v{CLIENT_VERSION}
        </span>
      </header>
      <main className="mt-8 rounded-xl border border-slate-200 bg-white p-6 text-slate-700">
        <p>Coming in Phase 1: your cats, and a Feed button.</p>
      </main>
    </div>
  );
}
