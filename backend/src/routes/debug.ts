import type { DebugLogsResponse } from "@feedme2/shared";
import { Hono } from "hono";
import type { Bindings } from "../env.ts";
import { logBuffer } from "../logger.ts";

const DEFAULT_LIMIT = 100;

/**
 * Debug endpoints for the webapp's hidden console.
 * GET /api/debug/logs?limit=N — recent worker log lines, oldest →
 * newest, from the per-isolate ring buffer (best-effort history; the
 * persisted D1 view arrives in Phase 1 along with house auth).
 *
 * TODO(phase1): mount requireHouse() in front of this router (spec §3.2,
 * §4.6). Unauthenticated in Phase 0 only because no auth exists yet and
 * the buffer holds request paths without query strings, nothing personal.
 */
export const debugRouter = new Hono<{ Bindings: Bindings }>().get("/logs", (c) => {
  const raw = Number(c.req.query("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, DEFAULT_LIMIT) : DEFAULT_LIMIT;
  const body: DebugLogsResponse = { entries: logBuffer.toArray().slice(-limit) };
  return c.json(body);
});
