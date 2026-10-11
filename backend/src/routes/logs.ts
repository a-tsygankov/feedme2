import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { LogsUploadBodySchema } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { parseClientId } from "../request-context.ts";
import { LogsRepo } from "../repos/logs.ts";
import { validationHook } from "../validation.ts";

const MAX_UPLOAD_BYTES = 128 * 1024;

/**
 * POST /api/logs — the web client's upload sink (spec §4.6).
 * The server stamps source=web and ignores whatever the body claims
 * (the schema strips source/deviceId): a browser must not be able to
 * forge worker or device rows in the house's feed.
 */
export const logsRouter = new Hono<{ Bindings: Bindings } & AuthVars>()
  .use("*", requireHouse())
  // 50 entries of ~1 KB data is ~60 KB; 128 KB is generous. Without the
  // cap the validator would buffer and parse whatever the runtime accepts.
  .post(
    "/",
    bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: (c) => c.json({ error: "payload_too_large" }, 413) }),
    zValidator("json", LogsUploadBodySchema, validationHook),
    async (c) => {
      const headerClientId = parseClientId(c.req.header("x-client-id"));
      const entries = c.req.valid("json").map((e) => {
        const clientId = headerClientId ?? e.clientId;
        return { ...e, source: "web" as const, ...(clientId ? { clientId } : {}) };
      });
      await new LogsRepo(db(c.env.DB)).insertMany(c.var.houseId, entries, {}, Date.now());
      return c.body(null, 202);
    },
  );
