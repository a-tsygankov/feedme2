import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Mounts `useHook` once (react-dom/client + act(), no testing-library in this repo) and returns its result, the
 * QueryClient, and an unmount. A cached ["report", …] entry is seeded so a test can read whether it was invalidated.
 */
export async function mountHook<T>(useHook: () => T): Promise<{ result: T; qc: QueryClient; reportKey: readonly unknown[]; unmount: () => void }> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const reportKey = ["report", "UTC", "2026-03-01", "2026-03-31", null, "day"] as const;
  qc.setQueryData(reportKey, { seeded: true });
  let result: T | undefined;
  function Probe() {
    result = useHook();
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  await act(async () => { root.render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>); });
  return {
    result: result as T, qc, reportKey,
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}
