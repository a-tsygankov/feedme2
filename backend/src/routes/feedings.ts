import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { decodeFeedingsCursor, FeedingCreateSchema, FeedingPatchSchema, FeedingsCursorSchema, type FeedingsPage } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { clock } from "../auth/tokens.ts";
import { db } from "../db/client.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { CatsRepo } from "../repos/cats.ts";
import { assertCatsInHouse, FeedingsRepo, toApiFeeding } from "../repos/feedings.ts";
import { validationHook } from "../validation.ts";

/** Same 2100-01-01 cap as the schema's fedAt, so a bound never exceeds D1's safe integers. */
const MAX_EPOCH_MS = 4_102_444_800_000;

const PageQuerySchema = z.object({
  cat: z.string().uuid().optional(),
  from: z.coerce.number().int().nonnegative().max(MAX_EPOCH_MS).optional(),
  to: z.coerce.number().int().nonnegative().max(MAX_EPOCH_MS).optional(),
  cursor: FeedingsCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const ClientIdHeader = "x-client-id";
/** A client id is a tab/install tag for debugging; anything else is ignored rather than stored. */
const CLIENT_ID_RE = /^[\w-]{1,64}$/;

/**
 * How far past the server clock a fedAt may be. Phone clocks drift and the
 * device syncs on its own RTC, so a few minutes of skew is normal; anything
 * beyond is a wrong clock or a typo that would pin the cat's "last fed" in
 * the future. DECISION PENDING with the owner: reject (this) versus clamp to
 * now. The webapp guards client-side, so the server only sees the odd case.
 */
const FUTURE_SKEW_MS = 5 * 60_000;

export const feedingsRouter = new Hono<{ Bindings: Bindings } & AuthVars>()
  .use("*", requireHouse())
  .get("/", zValidator("query", PageQuerySchema, validationHook), async (c) => {
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
  .post("/", zValidator("json", z.array(FeedingCreateSchema).min(1).max(100), validationHook), async (c) => {
    const d = db(c.env.DB);
    const items = c.req.valid("json");
    const houseId = c.var.houseId;
    const now = clock.now();
    const maxMs = now + FUTURE_SKEW_MS;

    // Whole batch or nothing: one bad item must not leave the rest half-synced.
    const future = items.filter((i) => i.fedAt > maxMs).map((i) => i.id);
    if (future.length > 0) return c.json({ error: "fedat_in_future", maxMs, ids: future }, 400);

    // The composite FK would reject a foreign cat with a 500; answer 404 first
    // so another house's cat ids are indistinguishable from nonexistent ones.
    // A soft-deleted cat of THIS house passes on purpose: an outbox replay made
    // after the cat was deleted must not fail the whole batch.
    const missing = await assertCatsInHouse(new CatsRepo(d), houseId, items.map((i) => i.catId));
    if (missing.length > 0) return c.json({ error: "cat_not_found", catIds: missing }, 404);

    const repo = new FeedingsRepo(d);
    const ids = [...new Set(items.map((i) => i.id))];
    // The id is a global primary key: one that belongs to another house would
    // be dropped by ON CONFLICT DO NOTHING and look "already synced", so the
    // client would never learn its feeding was lost. Not atomic with the insert,
    // but the insert still cannot overwrite or leak that row.
    const foreign = await repo.idsOwnedByOtherHouses(houseId, ids);
    if (foreign.length > 0) return c.json({ error: "id_conflict", ids: foreign }, 409);

    const header = c.req.header(ClientIdHeader);
    const clientId = header !== undefined && CLIENT_ID_RE.test(header) ? header : null;
    const accepted = await repo.createMany(houseId, items, { source: "web", clientId }, now);

    // Replay contract: an id that already exists in this house is not in
    // `accepted`, and `feedings` holds only LIVE rows, so replaying the id of a
    // soft-deleted feeding yields neither (it is never resurrected). Rows come
    // back in request order, one per distinct live id.
    const rows = new Map((await repo.getMany(houseId, ids)).map((r) => [r.id, r]));
    const feedings = ids.flatMap((id) => {
      const r = rows.get(id);
      return r ? [toApiFeeding(r)] : [];
    });
    return c.json({ accepted, feedings }, 201);
  })
  .patch("/:id", zValidator("json", FeedingPatchSchema, validationHook), async (c) => {
    const d = db(c.env.DB);
    const patch = c.req.valid("json");
    const now = clock.now();
    const maxMs = now + FUTURE_SKEW_MS;
    if (patch.fedAt !== undefined && patch.fedAt > maxMs) return c.json({ error: "fedat_in_future", maxMs }, 400);
    // Moving to a soft-deleted cat of this house is allowed (see POST).
    if (patch.catId) {
      const missing = await assertCatsInHouse(new CatsRepo(d), c.var.houseId, [patch.catId]);
      if (missing.length > 0) return c.json({ error: "cat_not_found", catIds: missing }, 404);
    }
    const row = await new FeedingsRepo(d).update(c.var.houseId, c.req.param("id"), patch, now);
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ feeding: toApiFeeding(row) });
  })
  .delete("/:id", async (c) => {
    const repo = new FeedingsRepo(db(c.env.DB));
    const houseId = c.var.houseId;
    const id = c.req.param("id");
    // Idempotent: a retry after a lost response finds it already deleted and
    // still gets 204. Unknown ids and other houses' ids are both 404.
    const existing = await repo.getAnyInHouse(houseId, id);
    if (!existing) return c.json({ error: "not found" }, 404);
    if (existing.deletedAt === null) await repo.softDelete(houseId, id, clock.now());
    return c.body(null, 204);
  });
