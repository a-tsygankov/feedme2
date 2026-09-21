/// <reference lib="webworker" />
/**
 * The service worker. Hand-written (injectManifest) so it can host
 * custom handlers later; the cost is that precaching is our job —
 * `precacheAndRoute` below is what keeps the installed app opening
 * with no connectivity. Treat it as load-bearing.
 */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { clientsClaim } from "workbox-core";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// A new worker waits until the page asks (via the update bar). Taking
// over at install would serve a new precache to a page still running
// the old bundle, which 404s on lazy chunks the new build dropped.
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | undefined)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Client-routed URLs are not precached assets; without this fallback
// every route but "/" 404s offline.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")));
