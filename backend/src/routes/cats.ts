import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { CatCreateSchema, CatPatchSchema, MAX_CATS } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { isUniqueViolation } from "../db/errors.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { validationHook } from "../validation.ts";
import { CatsRepo, toApiCat } from "../repos/cats.ts";
import { HousesRepo } from "../repos/houses.ts";

export const catsRouter = new Hono<{ Bindings: Bindings } & AuthVars>()
  .use("*", requireHouse())
  .get("/", async (c) => {
    const rows = await new CatsRepo(db(c.env.DB)).list(c.var.houseId);
    return c.json({ cats: rows.map(toApiCat) });
  })
  .post("/", zValidator("json", CatCreateSchema, validationHook), async (c) => {
    const d = db(c.env.DB);
    const repo = new CatsRepo(d);
    const input = c.req.valid("json");
    // Idempotent re-send (offline retry). First write wins: a re-POST of the
    // same id with a different body returns the stored cat unchanged and does
    // not update it (PATCH does that).
    const replay = async () => {
      const existing = await repo.getAny(input.id);
      if (!existing) return undefined;
      // Never leak another house's cat.
      if (existing.houseId !== c.var.houseId) return c.json({ error: "not found" }, 404);
      // A retried create must not resurrect a deleted cat.
      if (existing.deletedAt !== null) return c.json({ error: "cat_deleted" }, 410);
      return c.json({ cat: toApiCat(existing) }, 200);
    };
    const replayed = await replay();
    if (replayed) return replayed;
    const house = await new HousesRepo(d).findById(c.var.houseId);
    if (!house) return c.json({ error: "unauthorized" }, 401);
    try {
      const row = await repo.create(c.var.houseId, input, house.hungryAfterSecDefault, Date.now());
      if (!row) return c.json({ error: `at most ${MAX_CATS} cats` }, 409);
      return c.json({ cat: toApiCat(row) }, 201);
    } catch (err) {
      if (!isUniqueViolation(err, "cats.id")) throw err;
      // Lost a race on the id. The same house retrying concurrently is an
      // idempotent replay; another house taking the id is a conflict (409,
      // not 404, because the row did not exist when we looked).
      const raced = await repo.getAny(input.id);
      if (raced?.houseId === c.var.houseId) return (await replay())!;
      return c.json({ error: "id conflict" }, 409);
    }
  })
  .patch("/:id", zValidator("json", CatPatchSchema, validationHook), async (c) => {
    const row = await new CatsRepo(db(c.env.DB)).update(c.var.houseId, c.req.param("id"), c.req.valid("json"), Date.now());
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ cat: toApiCat(row) });
  })
  .delete("/:id", async (c) => {
    const repo = new CatsRepo(db(c.env.DB));
    const id = c.req.param("id");
    if (await repo.softDeleteUnlessLast(c.var.houseId, id, Date.now())) return c.body(null, 204);
    // Nothing changed: work out why.
    if (await repo.get(c.var.houseId, id)) return c.json({ error: "a house keeps at least one cat" }, 409);
    const any = await repo.getAny(id);
    // Already deleted in this house: DELETE is idempotent. Another house's
    // cat is indistinguishable from a missing one.
    if (any && any.houseId === c.var.houseId) return c.body(null, 204);
    return c.json({ error: "not found" }, 404);
  });
