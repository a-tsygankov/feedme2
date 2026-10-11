export interface Ordered { id: string; sortOrder: number }

/**
 * The cat list after moving `id` one place up (-1) or down (+1), renumbered
 * 0..n-1. Writing only the moved cat's new index left two cats on the same
 * sortOrder, so the display order depended on the database's tie-break.
 * Renumbering the whole list makes ties impossible. Input order breaks ties in
 * the stored values, matching what the list on screen shows.
 */
export function moveCat(cats: readonly Ordered[], id: string, dir: -1 | 1): Ordered[] {
  const sorted = [...cats].sort((a, b) => a.sortOrder - b.sortOrder);
  const from = sorted.findIndex((c) => c.id === id);
  const to = from + dir;
  if (from >= 0 && to >= 0 && to < sorted.length) {
    const [moved] = sorted.splice(from, 1);
    if (moved) sorted.splice(to, 0, moved);
  }
  return sorted.map((c, i) => ({ id: c.id, sortOrder: i }));
}

/** Entries of `after` whose sortOrder differs from `before`: the only PATCHes worth sending. */
export function orderChanges(before: readonly Ordered[], after: readonly Ordered[]): Ordered[] {
  const was = new Map(before.map((c) => [c.id, c.sortOrder]));
  return after.filter((c) => was.get(c.id) !== c.sortOrder);
}
