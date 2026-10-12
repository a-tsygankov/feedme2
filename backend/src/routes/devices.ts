import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { DeviceIdSchema, DevicePatchSchema } from "@feedme2/shared";
import { z } from "zod";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { clock } from "../auth/tokens.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { DevicesRepo, toApiDevice } from "../repos/devices.ts";
import { validationHook } from "../validation.ts";

const ParamSchema = z.object({ id: DeviceIdSchema });

export const devicesRouter = new Hono<{ Bindings: Bindings } & AuthVars>()
  .use("*", requireHouse())
  .get("/", async (c) => {
    const rows = await new DevicesRepo(db(c.env.DB)).list(c.var.houseId);
    return c.json({ devices: rows.map(toApiDevice) });
  })
  .patch("/:id", zValidator("param", ParamSchema, validationHook), zValidator("json", DevicePatchSchema, validationHook), async (c) => {
    const row = await new DevicesRepo(db(c.env.DB)).update(c.var.houseId, c.req.valid("param").id, c.req.valid("json"), clock.now());
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ device: toApiDevice(row) });
  })
  // "Forget": the token stops working at the next call (requireDevice reads revoked_at).
  .delete("/:id", zValidator("param", ParamSchema, validationHook), async (c) => {
    const ok = await new DevicesRepo(db(c.env.DB)).revoke(c.var.houseId, c.req.valid("param").id, clock.now());
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.body(null, 204);
  });
