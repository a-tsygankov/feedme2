import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { App } from "./App.tsx";
import { appLog, installGlobalErrorCapture } from "./lib/logger.ts";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: queryPersister, maxAge: 7 * 24 * 3600 * 1000 }}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
