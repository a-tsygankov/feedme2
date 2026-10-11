import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { App } from "./App.tsx";
import { authStore, crossesSessionBoundary } from "./lib/auth-store.ts";
import { api } from "./lib/api-client.ts";
import { createUploadSink, visibleInterval } from "./lib/log-upload.ts";
import { appLog, attachSink, installGlobalErrorCapture } from "./lib/logger.ts";
import { CLIENT_VERSION } from "./lib/versions.ts";
import { startUpdateWatch } from "./lib/pwa-update-browser.ts";
import { queryPersister } from "./lib/query-persister.ts";
import { startSyncTriggers } from "./lib/sync-engine.ts";
import { bootTheme, followSystemTheme } from "./lib/theme.ts";
import "./styles.css";

// Uncaught errors go to the hidden console's client feed — on a phone
// there are no devtools.
installGlobalErrorCapture(appLog, window);
appLog.info("app started", { version: CLIENT_VERSION });

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
startSyncTriggers();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, networkMode: "always", gcTime: 24 * 3600 * 1000 },
    mutations: { networkMode: "always" },
  },
});

// Cache isolation: the query cache (and its Dexie copy) belongs to one house's session. On sign-out, or if the house
// changes, drop it, or the next person on this phone would see the previous house's cats and feedings.
// TODO(spec Q4): the Dexie outbox is deliberately NOT cleared here, so feedings queued offline are not lost. They
// belong to the previous house, though; once ops carry a houseId (or the client id maps to a house) a flush under
// another house's token must be refused instead of silently logged there.
let lastSession = authStore.getSnapshot();
authStore.subscribe(() => {
  const next = authStore.getSnapshot();
  const reset = crossesSessionBoundary(lastSession, next);
  lastSession = next;
  if (!reset) return;
  void queryClient.cancelQueries();
  queryClient.clear();
  void queryPersister.removeClient();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: queryPersister, maxAge: 7 * 24 * 3600 * 1000 }}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
