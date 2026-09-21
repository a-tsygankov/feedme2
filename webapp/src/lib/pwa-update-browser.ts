/**
 * The browser half of self-update: registration, update checks, and
 * the events that drive the store. Deliberately logic-free — every
 * decision lives in pwa-update.ts.
 */
import { createUpdateStore, isNewerBuildServed, VERSION_POLL_MS, type UpdateStore } from "./pwa-update.ts";
import { appLog } from "./logger.ts";
import { CLIENT_VERSION } from "./versions.ts";

let waiting: ServiceWorker | null = null;
let registration: ServiceWorkerRegistration | null = null;
let swAvailable = false;

export const updateStore: UpdateStore = createUpdateStore({
  skipWaiting: () => waiting?.postMessage({ type: "SKIP_WAITING" }),
  reload: () => window.location.reload(),
});

/** Installed while another worker controls the page = an update. The
 * same state with no controller is the first install: not news. */
function offerIfUpdate(worker: ServiceWorker | null): void {
  if (worker === null || navigator.serviceWorker.controller === null) return;
  waiting = worker;
  updateStore.markReady();
}

async function servedVersion(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { webapp?: string }).webapp ?? null;
  } catch {
    return null;
  }
}

// No service worker means no precache: a plain reload fetches the new
// bundle, so "ready" can be honoured with reload() alone.
async function checkNow(): Promise<void> {
  const newer = isNewerBuildServed(await servedVersion(), CLIENT_VERSION);
  if (registration !== null) {
    if (newer) appLog.info("newer build served, checking service worker");
    // Cheap and idempotent; run it on every visibility change regardless,
    // the version poll only adds the log line above.
    void registration.update();
    return;
  }
  if (newer) {
    appLog.info("newer build served, no service worker: offering reload");
    updateStore.markReady("reload");
  }
}

/** Start listening. Where service workers are unavailable, registration
 * is skipped but the version poll still runs so a reload-only update
 * can be offered. */
export function startUpdateWatch(): void {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => updateStore.onControllerChange());

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        registration = reg;
        swAvailable = true;
        offerIfUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (installing === null) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed") offerIfUpdate(installing);
          });
        });
      })
      .catch((error: unknown) => {
        appLog.warn("service worker registration failed", { error: String(error) });
      });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkNow();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void checkNow();
  }, VERSION_POLL_MS);
}
