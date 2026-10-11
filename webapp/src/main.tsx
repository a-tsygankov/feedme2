import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { App } from "./App.tsx";
import { SyncDroppedBanner } from "./components/SyncBadge.tsx";
import { authStore, crossesSessionBoundary } from "./lib/auth-store.ts";
import { api } from "./lib/api-client.ts";
import { createUploadSink, visibleInterval } from "./lib/log-upload.ts";
import { appLog, attachSink, installGlobalErrorCapture } from "./lib/logger.ts";
import { CLIENT_VERSION } from "./lib/versions.ts";
import { startUpdateWatch } from "./lib/pwa-update-browser.ts";
import { PERSIST_MAX_AGE_MS, queryPersister } from "./lib/query-persister.ts";
import { startSyncTriggers, syncEngine } from "./lib/sync-engine.ts";
import { bootTheme, followSystemTheme } from "./lib/theme.ts";
import "./styles.css";

// Uncaught errors go to the hidden console's client feed — on a phone
// there are no devtools.
installGlobalErrorCapture(appLog, window);
appLog.info("app started", { version: CLIENT_VERSION });

// Ask the browser not to evict IndexedDB under storage pressure: the outbox may hold the only copy of a feeding.
// Best effort; the answer (and a missing API) changes nothing.
try { void navigator.storage?.persist?.().catch(() => undefined); } catch { /* not available */ }

// Web log lines also reach the house's persisted feed, so another phone's console shows this phone's crash. The
// sink starts dropping lines the moment the auth store says signed out.
const uploadSink = createUploadSink({
  send: (batch, opts) => api.uploadLogs(batch, opts?.keepalive ? { keepalive: true } : {}).then(() => undefined),
  isSignedIn: () => authStore.getSnapshot().status === "signedIn",
  now: Date.now,
  schedule: visibleInterval,
});
attachSink(uploadSink);
// Best effort: whatever is queued when the page is hidden or closing goes out now, because the 30 s timer may
// never fire again (iOS freezes background tabs).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void uploadSink.flush({ keepalive: true });
});
window.addEventListener("pagehide", () => {
  void uploadSink.flush({ keepalive: true });
  uploadSink.stop();
});

// public/theme-boot.js already applied the theme before first paint;
// this is the in-bundle fallback plus the OS follower for "system".
bootTheme(window, document);
followSystemTheme(window, document);

startUpdateWatch();

// Boot drain waits for the persisted query cache to be restored (markHydrated below): a drain that finished first
// would invalidate queries and the restore would then paint the old data over the fresh refetch.
const syncTriggers = startSyncTriggers();
(import.meta as unknown as { hot?: { dispose(cb: () => void): void } }).hot?.dispose(() => syncTriggers.stop());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, networkMode: "always", gcTime: PERSIST_MAX_AGE_MS },
    mutations: { networkMode: "always" },
  },
});

// What a drain changed on the server (a create landing, an edit applied, a change refused) is only visible after the
// lists are refetched. This is the one place that happens, whichever screen started the drain.
syncEngine.onDrained((r) => {
  if (r.sent === 0 && r.dropped.length === 0) return;
  void queryClient.invalidateQueries({ queryKey: ["cats"] });
  void queryClient.invalidateQueries({ queryKey: ["feedings"] });
  void queryClient.invalidateQueries({ queryKey: ["feedings-history"] });
});

// Cache isolation: the query cache (and its Dexie copy) belongs to one house's session. On sign-out, or if the house
// changes, drop it, or the next person on this phone would see the previous house's cats and feedings.
// The Dexie outbox is deliberately NOT cleared here, so feedings queued offline are not lost. Each row carries the
// house that queued it and is only ever sent under that house's session (see sync-engine); on sign-out the engine
// logs a warning if any are left.
let lastSession = authStore.getSnapshot();
authStore.subscribe(() => {
  const next = authStore.getSnapshot();
  const reset = crossesSessionBoundary(lastSession, next);
  lastSession = next;
  const { houseId, changed } = syncEngine.sessionChanged();
  // Signing in (or into another house) is when that house's queued feedings can finally go out.
  if (changed && houseId) void syncEngine.drain();
  if (!reset) return;
  void queryClient.cancelQueries();
  queryClient.clear();
  void queryPersister.removeClient();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: queryPersister, maxAge: PERSIST_MAX_AGE_MS, buster: CLIENT_VERSION }}
      onSuccess={syncTriggers.markHydrated}
      onError={syncTriggers.markHydrated}
    >
      <BrowserRouter>
        <App />
        <SyncDroppedBanner />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
