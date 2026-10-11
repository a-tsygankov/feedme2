/**
 * True when `err` (or anything in its `cause` chain) is a SQLite UNIQUE
 * violation, optionally on a specific column such as "cats.id". D1 and
 * drizzle wrap driver errors differently between versions, so the text is
 * matched at every level of the chain instead of on the outer error only.
 * Matching on text is a last resort: callers should pre-check where the
 * common case is predictable and keep this for the race.
 */
export function isUniqueViolation(err: unknown, column?: string): boolean {
  const seen = new Set<unknown>();
  for (let e: unknown = err; e instanceof Error && !seen.has(e); e = e.cause) {
    seen.add(e);
    if (/UNIQUE constraint failed/i.test(e.message) && (column === undefined || e.message.includes(column))) return true;
  }
  return false;
}
