import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.tsx";
import { appLog, installGlobalErrorCapture } from "./lib/logger.ts";
import { CLIENT_VERSION } from "./lib/versions.ts";
import { startUpdateWatch } from "./lib/pwa-update-browser.ts";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, networkMode: "always" },
    mutations: { networkMode: "always" },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
