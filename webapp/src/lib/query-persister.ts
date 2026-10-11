import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { feedmeDb } from "./db.ts";

/** How long a persisted cache is trusted. Also the in-memory gcTime: a query garbage-collected sooner than it may be
 * restored would be dropped from the next persisted snapshot, defeating the point of persisting it. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/** TanStack Query cache → Dexie kv, so the dashboard renders the last
 * known cats and feedings with no network. */
export const queryPersister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => (await feedmeDb.kv.get(key))?.value ?? null,
    setItem: async (key, value) => { await feedmeDb.kv.put({ key, value }); },
    removeItem: async (key) => { await feedmeDb.kv.delete(key); },
  },
  key: "feedme2:query-cache",
  // Short on purpose: a reload inside the throttle window restores the pre-change cache (see saveOnHide).
  throttleTime: 250,
});

interface Target { addEventListener(t: string, l: () => void): void; removeEventListener(t: string, l: () => void): void }

/**
 * Save the query cache when the page is hidden or closing. Incident: "add cat", then reload within 1 s showed "No cats
 * yet." - the throttled save had not run, the restored cache was fresh enough (staleTime 30 s) and nothing refetched.
 * Best effort: the persister's throttle can still delay the write by up to its interval, and a failed save is dropped.
 */
export function saveOnHide(
  win: Target,
  doc: Target & { visibilityState: string },
  save: () => Promise<void> | void,
): () => void {
  const run = () => { try { void Promise.resolve(save()).catch(() => undefined); } catch { /* best effort */ } };
  const onVisibility = () => { if (doc.visibilityState === "hidden") run(); };
  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("pagehide", run);
  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("pagehide", run);
  };
}
