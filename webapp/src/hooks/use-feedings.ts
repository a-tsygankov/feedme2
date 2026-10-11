import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";

export const feedingsKey = (q: Record<string, unknown>) => ["feedings", q] as const;

/** Feedings from `fromMs` onward (today's totals on the dashboard). */
export function useFeedingsSince(fromMs: number, catId?: string) {
  const q = { from: fromMs, ...(catId ? { cat: catId } : {}), limit: 200 };
  return useQuery({ queryKey: feedingsKey(q), queryFn: () => api.listFeedings(q).then((p) => p.items) });
}

export function startOfLocalDay(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
