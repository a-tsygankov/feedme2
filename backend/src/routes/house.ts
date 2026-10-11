import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HousePatchSchema } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { isUniqueViolation } from "../db/errors.ts";
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
    const repo = new HousesRepo(db(c.env.DB));
    const patch = c.req.valid("json");
    // Pre-check so the common case does not depend on error text. A case-only
    // rename finds the caller's own row, which is fine.
    if (patch.name !== undefined) {
      const taken = await repo.findByName(patch.name);
      if (taken && taken.id !== c.var.houseId) return c.json({ error: "name taken" }, 409);
    }
    try {
      const house = await repo.updateSettings(c.var.houseId, patch, Date.now());
      return c.json({ house: toApiHouse(house) });
    } catch (err) {
      // Lost a race with another rename or signup to the same name.
      if (isUniqueViolation(err)) return c.json({ error: "name taken" }, 409);
      throw err;
    }
  });
