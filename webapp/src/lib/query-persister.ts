import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { feedmeDb } from "./db.ts";

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
