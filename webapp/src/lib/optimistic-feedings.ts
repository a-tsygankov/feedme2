import type { Feeding } from "@feedme2/shared";

/** The params object of a ["feedings", params] query key (see hooks/use-feedings.ts), or {} if it has none. */
function paramsOf(key: readonly unknown[]): { cat?: unknown; from?: unknown; to?: unknown } {
  const p = key[1];
  return typeof p === "object" && p !== null ? p : {};
}

const newestFirst = (a: Feeding, b: Feeding) => b.fedAt - a.fedAt || (a.id < b.id ? 1 : -1);

/**
 * The next value of one cached feedings list after `added` were logged locally, or undefined to leave it alone.
 * Only feedings the list's own query would return go in (its cat filter, its from/to window), and they go in by time
 * rather than on top: a backdated feeding in the middle of today's list used to appear as the newest. A list with no
 * data is never seeded: that would turn "still loading" into "loaded, and these are all the feedings".
 */
export function insertOptimistic(key: readonly unknown[], old: unknown, added: Feeding[]): Feeding[] | undefined {
  if (!Array.isArray(old)) return undefined;
  const p = paramsOf(key);
  const have = new Set((old as Feeding[]).map((f) => f.id));
  const fresh = added.filter((f) =>
    !have.has(f.id)
    && (p.cat === undefined || p.cat === f.catId)
    && (typeof p.from !== "number" || f.fedAt >= p.from)
    && (typeof p.to !== "number" || f.fedAt <= p.to));
  if (fresh.length === 0) return undefined;
  return [...(old as Feeding[]), ...fresh].sort(newestFirst);
}
