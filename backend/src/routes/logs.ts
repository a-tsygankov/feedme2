import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { LogsUploadBodySchema } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { LogsRepo } from "../repos/logs.ts";
import { validationHook } from "../validation.ts";

/**
 * POST /api/logs — the web client's upload sink (spec §4.6).
 * The server stamps source=web and ignores whatever the body claims
 * (the schema strips source/deviceId): a browser must not be able to
 * forge worker or device rows in the house's feed.
 */
export const logsRouter = new Hono<{ Bindings: Bindings } & AuthVars>()
  .use("*", requireHouse())
  .post("/", zValidator("json", LogsUploadBodySchema, validationHook), async (c) => {
    const headerClientId = c.req.header("x-client-id")?.slice(0, 64) || undefined;
    const entries = c.req.valid("json").map((e) => {
      const clientId = headerClientId ?? e.clientId;
      return { ...e, source: "web" as const, ...(clientId ? { clientId } : {}) };
    });
    await new LogsRepo(db(c.env.DB)).insertMany(c.var.houseId, entries, {}, Date.now());
    return c.body(null, 202);
  });
