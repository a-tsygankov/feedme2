import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { CatCreateSchema, CatPatchSchema, MAX_CATS } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { CatsRepo, toApiCat } from "../repos/cats.ts";
import { HousesRepo } from "../repos/houses.ts";

export const catsRouter = new Hono<{ Bindings: Bindings } & AuthVars>()
  .use("*", requireHouse())
  .get("/", async (c) => {
    const rows = await new CatsRepo(db(c.env.DB)).list(c.var.houseId);
    return c.json({ cats: rows.map(toApiCat) });
  })
  .post("/", zValidator("json", CatCreateSchema), async (c) => {
    const d = db(c.env.DB);
    const repo = new CatsRepo(d);
    const input = c.req.valid("json");
    const existing = await repo.getAny(input.id);
    if (existing) {
      // Idempotent re-send (offline retry) — but never leak another house's cat.
      if (existing.houseId !== c.var.houseId) return c.json({ error: "not found" }, 404);
      return c.json({ cat: toApiCat(existing) }, 200);
    }
    if ((await repo.countLive(c.var.houseId)) >= MAX_CATS) return c.json({ error: `at most ${MAX_CATS} cats` }, 409);
    const house = await new HousesRepo(d).findById(c.var.houseId);
    if (!house) return c.json({ error: "unauthorized" }, 401);
    const row = await repo.create(c.var.houseId, input, house.hungryAfterSecDefault, Date.now());
    return c.json({ cat: toApiCat(row) }, 201);
  })
  .patch("/:id", zValidator("json", CatPatchSchema), async (c) => {
    const row = await new CatsRepo(db(c.env.DB)).update(c.var.houseId, c.req.param("id"), c.req.valid("json"), Date.now());
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ cat: toApiCat(row) });
  })
  .delete("/:id", async (c) => {
    const repo = new CatsRepo(db(c.env.DB));
    const row = await repo.get(c.var.houseId, c.req.param("id"));
    if (!row) return c.json({ error: "not found" }, 404);
    if ((await repo.countLive(c.var.houseId)) <= 1) return c.json({ error: "a house keeps at least one cat" }, 409);
    await repo.softDelete(c.var.houseId, row.id, Date.now());
    return c.body(null, 204);
  });
