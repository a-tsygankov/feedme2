import type { QueryKey } from "@tanstack/react-query";
import type { DrainReport } from "./sync-engine.ts";

/**
 * Which query roots a finished drain makes stale. The lists hold optimistic rows, so they refetch after any drain
 * that did something, a refused op included (its optimistic row must go). Reports hold no optimistic data and a
 * refused op changed nothing on the server, so they refetch only when something was sent; before this they only
 * caught up on their 60 s staleTime, and a feeding logged offline stayed missing from the cat's trends after it synced.
 */
export function queriesToRefreshAfterDrain(r: DrainReport): QueryKey[] {
  if (r.sent === 0 && r.dropped.length === 0) return [];
  const lists: QueryKey[] = [["cats"], ["feedings"], ["feedings-history"]];
  return r.sent > 0 ? [...lists, ["report"]] : lists;
}

/**
 * What the cat page refetches after its own edit or delete settles. Reports are included: an edit moves a feeding's
 * amount, time or cat, and without this the trends panel above the history (and Reports) showed the old day for up
 * to their 60 s staleTime.
 */
export const REFRESH_AFTER_EDIT: readonly QueryKey[] = [["feedings"], ["feedings-history"], ["cats"], ["report"]];
