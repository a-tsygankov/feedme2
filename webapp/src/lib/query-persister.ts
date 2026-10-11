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
  throttleTime: 1000,
});
