/**
 * Whether a newer build is waiting, and what to do about it.
 *
 * The app is a PWA people leave open. The browser looks for a new
 * sw.js on navigation or roughly daily, and even then the running page
 * keeps its old bundle until a reload. Decisions live here, DOM-free
 * and unit-tested; pwa-update-browser.ts is the glue.
 */
import { compareVersions } from "@feedme2/shared";

/** `dismissed` is "not now"; a newer build clears it. */
export type UpdateState = "idle" | "ready" | "dismissed";

export interface UpdateStoreDeps {
  skipWaiting: () => void;
  reload: () => void;
}

export interface UpdateStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): UpdateState;
  /** A new worker is installed and waiting. */
  markReady(): void;
  dismiss(): void;
  apply(): void;
  /** The active worker changed. */
  onControllerChange(): void;
}

export function createUpdateStore(deps: UpdateStoreDeps): UpdateStore {
  let state: UpdateState = "idle";
  let applying = false;
  let reloaded = false;
  const listeners = new Set<() => void>();

  function set(next: UpdateState): void {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => state,
    markReady: () => set("ready"),
    dismiss: () => set("dismissed"),
    apply() {
      if (state !== "ready" || applying) return;
      applying = true;
      deps.skipWaiting();
    },
    onControllerChange() {
      // Fires on the very first install too, and in every open tab
      // when any one of them applies — reload only the tab that asked.
      if (!applying || reloaded) return;
      reloaded = true;
      deps.reload();
    },
  };
}

/**
 * /version.json (emitted at build, never precached) says which webapp
 * version the server currently serves. Strictly newer than the running
 * bundle means "ask the service worker to look for an update now",
 * for browsers that would otherwise not check for a day (spec §4.5).
 */
export function isNewerBuildServed(served: string | null | undefined, running: string): boolean {
  if (typeof served !== "string" || served.length === 0) return false;
  return compareVersions(served, running) > 0;
}

/** Poll cadence for /version.json while the tab is visible. */
export const VERSION_POLL_MS = 10 * 60 * 1000;
