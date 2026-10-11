import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HousePatchSchema } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { validationHook } from "../validation.ts";
import { HousesRepo, toApiHouse } from "../repos/houses.ts";

export const houseRouter = new Hono<{ Bindings: Bindings } & AuthVars>()
  .use("*", requireHouse())
  .get("/", async (c) => {
    const house = await new HousesRepo(db(c.env.DB)).findById(c.var.houseId);
    if (!house) return c.json({ error: "unauthorized" }, 401);
    return c.json({ house: toApiHouse(house) });
  })
  .patch("/", zValidator("json", HousePatchSchema, validationHook), async (c) => {
    try {
      const house = await new HousesRepo(db(c.env.DB)).updateSettings(c.var.houseId, c.req.valid("json"), Date.now());
      return c.json({ house: toApiHouse(house) });
    } catch (err) {
      if (err instanceof Error && /UNIQUE/i.test(err.message)) return c.json({ error: "name taken" }, 409);
      throw err;
    }
  });
