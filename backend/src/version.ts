/**
 * Tier versions (spec §6.1):
 * - worker: backend/package.json, auto-bumped by the pre-commit hook,
 *   inlined at build time via the JSON import.
 * - schema: the latest APPLIED migration, from wrangler's d1_migrations
 *   tracker at runtime — truthful even when the worker ships ahead of
 *   a migration, or a fresh local DB has none.
 * - firmware: newest active row of firmware_releases (Phase 3). Until
 *   that table exists the query fails and we report null.
 */
import pkg from "../package.json";

export const WORKER_VERSION: string = pkg.version;

/**
 * "No such table" is the one expected failure: the schema tier reads
 * wrangler's tracker (absent on a fresh DB) and the firmware tier reads
 * a table that Phase 3 creates. Anything else — a D1 outage, a typo in
 * the query — must surface as a 500 the request middleware logs,
 * rather than masquerade as "none applied".
 */
function isMissingTable(err: unknown): boolean {
  return err instanceof Error && /no such table/i.test(err.message);
}

export async function getSchemaVersion(db: D1Database): Promise<string | null> {
  try {
    const row = await db
      // ORDER BY id, not name: wrangler's tracker id is insertion-ordered
      // and does not depend on the zero-padded filename convention.
      .prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")
      .first<{ name: string }>();
    return row?.name ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export async function getLatestFirmwareVersion(db: D1Database): Promise<string | null> {
  try {
    const row = await db
      .prepare("SELECT version FROM firmware_releases WHERE active = 1 ORDER BY created_at DESC LIMIT 1")
      .first<{ version: string }>();
    return row?.version ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}
