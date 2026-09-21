/**
 * The wordmark. It is a <h1> so tests can find it by role, and the
 * hidden console's triple-tap target — the handler is injected so the
 * component knows nothing about the console.
 */
interface Props {
  onTap?: () => void;
}

export function Logo({ onTap }: Props) {
  return (
    <h1
      data-testid="app-logo"
      // Intentionally pointer-only: a keyboard-focusable secret is not a secret.
      onClick={onTap}
      className="select-none text-xl font-bold tracking-tight text-slate-900"
    >
      feedme2
    </h1>
  );
}
