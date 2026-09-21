/**
 * Apply every migration in backend/migrations/ to the test D1, and
 * record it in wrangler's own `d1_migrations` tracker the way
 * `wrangler d1 migrations apply` would — so /api/version reports a
 * schema version in tests exactly as it does in production.
 */
import { env } from "cloudflare:test";

// Vite's glob import with ?raw gives us every migration's SQL text,
// keyed by path, without a filesystem read inside the worker.
const files = import.meta.glob("../../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const MIGRATIONS: Array<{ name: string; sql: string }> = Object.entries(files)
  .map(([path, sql]) => ({ name: path.split("/").pop()!, sql }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** The D1 runner strips `--` comments and splits on `;`. Mirror it. */
export function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function applyAllMigrations(): Promise<void> {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  for (const m of MIGRATIONS) {
    for (const stmt of splitStatements(m.sql)) await env.DB.exec(stmt);
    await env.DB.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(m.name).run();
  }
}
