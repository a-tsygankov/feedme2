import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { DebugLogsQuerySchema, type DebugLogsResponse } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { LogsRepo } from "../repos/logs.ts";
import { validationHook } from "../validation.ts";

/**
 * GET /api/debug/logs — the hidden console's merged feed: every
 * persisted entry for this house (worker lines made while serving it,
 * web uploads, device uploads from Phase 2), newest first, filterable by
 * source, level (exact), minLevel (rank), device and since. House-scoped since Phase 1; the
 * Phase 0 per-isolate ring buffer is gone.
 */
export const debugRouter = new Hono<{ Bindings: Bindings } & AuthVars>()
  .use("*", requireHouse())
  .get("/logs", zValidator("query", DebugLogsQuerySchema, validationHook), async (c) => {
    const entries = await new LogsRepo(db(c.env.DB)).query(c.var.houseId, c.req.valid("query"));
    const body: DebugLogsResponse = { entries };
    return c.json(body);
  });
