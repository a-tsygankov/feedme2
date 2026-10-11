import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { decodeFeedingsCursor, FeedingCreateSchema, FeedingPatchSchema, FeedingsCursorSchema, type FeedingsPage } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { CatsRepo } from "../repos/cats.ts";
import { FeedingsRepo, toApiFeeding } from "../repos/feedings.ts";

const PageQuerySchema = z.object({
  cat: z.string().uuid().optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  cursor: FeedingsCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const ClientIdHeader = "x-client-id";

export const feedingsRouter = new Hono<{ Bindings: Bindings } & AuthVars>()
  .use("*", requireHouse())
  .get("/", zValidator("query", PageQuerySchema), async (c) => {
    const q = c.req.valid("query");
    const { items, nextCursor } = await new FeedingsRepo(db(c.env.DB)).page(c.var.houseId, {
      ...(q.cat ? { catId: q.cat } : {}),
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.to !== undefined ? { to: q.to } : {}),
      ...(q.cursor ? { cursor: decodeFeedingsCursor(q.cursor) } : {}),
      limit: q.limit,
    });
    const body: FeedingsPage = { items: items.map(toApiFeeding), nextCursor };
    return c.json(body);
  })
  .post("/", zValidator("json", z.array(FeedingCreateSchema).min(1).max(100)), async (c) => {
    const d = db(c.env.DB);
    const items = c.req.valid("json");
    const catsRepo = new CatsRepo(d);
    // The composite FK would reject a foreign cat with a 500; answer 404 first
    // so another house's cat ids are indistinguishable from nonexistent ones.
    for (const catId of new Set(items.map((i) => i.catId))) {
      if (!(await catsRepo.get(c.var.houseId, catId))) return c.json({ error: "cat_not_found" }, 404);
    }
    const repo = new FeedingsRepo(d);
    const clientId = c.req.header(ClientIdHeader);
    const accepted = await repo.createMany(c.var.houseId, items, "web", clientId ? { clientId } : {}, Date.now());
    const rows = await repo.getMany(c.var.houseId, items.map((i) => i.id));
    return c.json({ accepted, feedings: rows.map(toApiFeeding) }, 201);
  })
  .patch("/:id", zValidator("json", FeedingPatchSchema), async (c) => {
    const d = db(c.env.DB);
    const patch = c.req.valid("json");
    if (patch.catId && !(await new CatsRepo(d).get(c.var.houseId, patch.catId))) return c.json({ error: "cat_not_found" }, 404);
    const row = await new FeedingsRepo(d).update(c.var.houseId, c.req.param("id"), patch, Date.now());
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ feeding: toApiFeeding(row) });
  })
  .delete("/:id", async (c) => {
    const ok = await new FeedingsRepo(db(c.env.DB)).softDelete(c.var.houseId, c.req.param("id"), Date.now());
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.body(null, 204);
  });
