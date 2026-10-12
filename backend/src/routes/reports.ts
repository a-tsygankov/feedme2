import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  aggregateReport, dayBoundsMs, daysBetween, DateKeySchema, defaultBucket, FEEDINGS_CSV_HEADERS, feedingCsvRow, isDateKey, MAX_HOUR_BUCKET_DAYS, MAX_REPORT_DAYS, REPORT_MAX_DATE, REPORT_MIN_DATE,
  ReportBucketSchema, toCsv,
} from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db, type Db } from "../db/client.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { CatsRepo } from "../repos/cats.ts";
import { FeedingsRepo } from "../repos/feedings.ts";
import { HousesRepo, toApiHouse } from "../repos/houses.ts";
import { validationHook } from "../validation.ts";

/**
 * A local-date range in the house's zone. Both ends are inclusive days; the
 * cap keeps a hostile "2000-01-01..2099-12-31" from reading every row, the
 * REPORT_MIN_DATE..REPORT_MAX_DATE window keeps the calendar math inside four-digit years.
 */
const RangeQuery = z.object({
  from: DateKeySchema,
  to: DateKeySchema,
  cat: z.string().uuid().optional(),
  bucket: ReportBucketSchema.optional(),
}).superRefine((q, ctx) => {
  // zod still runs this after a field refine failed: "2026-02-30" made daysBetween throw (a 500, not a 400).
  if (!isDateKey(q.from) || !isDateKey(q.to)) return;
  // Before any calendar math: "9999-12-31" stepped past year 9999 in dayBoundsMs and threw (a 500).
  // Plain string comparison is exact because isDateKey passed, so both are four-digit years.
  const outside = (k: string) => k < REPORT_MIN_DATE || k > REPORT_MAX_DATE;
  const msg = `outside ${REPORT_MIN_DATE}..${REPORT_MAX_DATE}`;
  if (outside(q.from)) ctx.addIssue({ code: "custom", path: ["from"], message: msg });
  if (outside(q.to)) ctx.addIssue({ code: "custom", path: ["to"], message: msg });
  if (outside(q.from) || outside(q.to)) return;
  if (q.to < q.from) ctx.addIssue({ code: "custom", path: ["to"], message: "before from" });
  else if (daysBetween(q.from, q.to) + 1 > MAX_REPORT_DAYS) ctx.addIssue({ code: "custom", path: ["to"], message: `range longer than ${MAX_REPORT_DAYS} days` });
  else if (q.bucket === "hour" && daysBetween(q.from, q.to) + 1 > MAX_HOUR_BUCKET_DAYS) {
    ctx.addIssue({ code: "custom", path: ["bucket"], message: `hour buckets cover at most ${MAX_HOUR_BUCKET_DAYS} days` });
  }
});
type Range = z.infer<typeof RangeQuery>;

/**
 * What both routes need: the house settings, every cat (removed ones too:
 * their feedings still count), and the range's real local midnights. Null
 * when `cat` is not a cat of this house.
 */
async function resolve(d: Db, houseId: string, q: Range) {
  // requireHouse() verified the token against a live house row, so it exists.
  const house = toApiHouse((await new HousesRepo(d).findById(houseId))!);
  const cats = await new CatsRepo(d).listIncludingDeleted(houseId);
  if (q.cat && !cats.some((x) => x.id === q.cat)) return null;
  const tz = house.settings.timezone;
  return { settings: house.settings, cats, tz, ...dayBoundsMs(q.from, q.to, tz) };
}

export const reportsRouter = new Hono<{ Bindings: Bindings } & AuthVars>()
  .use("*", requireHouse())
  .get("/summary", zValidator("query", RangeQuery, validationHook), async (c) => {
    const q = c.req.valid("query");
    const d = db(c.env.DB);
    const r = await resolve(d, c.var.houseId, q);
    if (!r) return c.json({ error: "cat_not_found" }, 404);
    const feedings = await new FeedingsRepo(d).listForReport(c.var.houseId, r.fromMs, r.toMs, q.cat);
    // Same as the CSV: private to the house and stale after the next feeding.
    c.header("cache-control", "no-store");
    return c.json(aggregateReport({
      feedings,
      cats: r.cats.filter((x) => !q.cat || x.id === q.cat).map((x) => ({ id: x.id, name: x.name, color: x.color, deleted: x.deletedAt !== null })),
      from: q.from, to: q.to, timeZone: r.tz, bucket: q.bucket ?? defaultBucket(q.from, q.to),
      foodUnit: r.settings.foodUnit, canSizeMg: r.settings.canSizeMg,
    }));
  })
  .get("/export.csv", zValidator("query", RangeQuery, validationHook), async (c) => {
    const q = c.req.valid("query");
    const d = db(c.env.DB);
    const r = await resolve(d, c.var.houseId, q);
    if (!r) return c.json({ error: "cat_not_found" }, 404);
    const names = new Map(r.cats.map((x) => [x.id, x.deletedAt === null ? x.name : `${x.name} (removed)`]));
    const rows = (await new FeedingsRepo(d).listForExport(c.var.houseId, r.fromMs, r.toMs, q.cat)).map((f) =>
      feedingCsvRow(
        { fedAt: f.fedAt, catName: names.get(f.catId) ?? "?", amountMg: f.amountMg, enteredUnit: f.enteredUnit, enteredValue: f.enteredValue, source: f.source, note: f.note },
        r.tz, r.settings.foodUnit, r.settings.canSizeMg,
      ));
    // BOM: Excel otherwise reads UTF-8 cat names as Latin-1.
    return c.body("﻿" + toCsv([[...FEEDINGS_CSV_HEADERS], ...rows]), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="feedme2-${q.from}-${q.to}.csv"`,
      "cache-control": "no-store",
    });
  });
