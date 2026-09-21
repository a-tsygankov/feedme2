import { Hono } from "hono";
import type { Bindings } from "../env.ts";
import { logBuffer } from "../logger.ts";

const DEFAULT_LIMIT = 100;

/**
 * Debug endpoints for the webapp's hidden console.
 * GET /api/debug/logs?limit=N — recent worker log lines, oldest →
 * newest, from the per-isolate ring buffer (best-effort history; the
 * persisted D1 view arrives in Phase 1 along with house auth).
 */
export const debugRouter = new Hono<{ Bindings: Bindings }>().get("/logs", (c) => {
  const raw = Number(c.req.query("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, DEFAULT_LIMIT) : DEFAULT_LIMIT;
  return c.json({ entries: logBuffer.toArray().slice(-limit) });
});
