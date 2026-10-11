import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";

/**
 * Key root "feedings" holds ARRAYS only (the select below unwraps the page). The dashboard's optimistic update
 * patches every ["feedings", ...] cache and relies on that shape; the infinite history query lives under
 * "feedings-history" for exactly that reason.
 */
export const feedingsKey = (q: Record<string, unknown>) => ["feedings", q] as const;

/**
 * Feedings from `fromMs` onward (today's totals on the dashboard). `fromMs` comes from the house's timezone day start
 * (lib/day-boundary), so the key only changes at midnight; keepPreviousData stops the card flashing to "nothing" then.
 */
export function useFeedingsSince(fromMs: number, catId?: string) {
  const q = { from: fromMs, ...(catId ? { cat: catId } : {}), limit: 200 };
  return useQuery({
    queryKey: feedingsKey(q),
    queryFn: () => api.listFeedings(q).then((p) => p.items),
    placeholderData: keepPreviousData,
  });
}
