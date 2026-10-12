import { SELF } from "cloudflare:test";
import { ReportSummarySchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";
import { randomSalt, SEED_FROM, SEED_TO, SEED_TZ, seedMonth } from "../../shared/src/testing/seed-month.ts";

type Session = Awaited<ReturnType<typeof signup>>;
const asFeeding = (f: { id: string; catId: string; fedAt: number; amountMg: number }) => ({ ...f, enteredUnit: "g", enteredValue: String(f.amountMg / 1000) });
const seed = seedMonth(randomSalt());
const SEED_CATS = seed.cats;
/** Unauthenticated request, same base URL as helpers/api.ts. */
const fetch_ = (path: string) => SELF.fetch(new Request(`http://feedme2${path}`));

async function seededHouse(): Promise<Session> {
  const s = await signup();
  await s.fetchAuthed("/api/house", { method: "PATCH", body: JSON.stringify({ timezone: SEED_TZ }) });
  for (const c of SEED_CATS) await s.fetchAuthed("/api/cats", { method: "POST", body: JSON.stringify({ id: c.id, name: c.name, color: c.color }) });
  const all = seed.feedings;
  for (let i = 0; i < all.length; i += 100) {
    const res = await s.fetchAuthed("/api/feedings", { method: "POST", body: JSON.stringify(all.slice(i, i + 100).map(asFeeding)) });
    expect(res.status).toBe(201);
  }
  return s;
}

const summary = async (s: Session, qs: string) => s.fetchAuthed(`/api/reports/summary?${qs}`);

describe("/api/reports", () => {
  let s: Session;
  beforeAll(async () => { await applyAllMigrations(); s = await seededHouse(); });

  it("summarises the seeded month in the house zone", async () => {
    const res = await summary(s, `from=${SEED_FROM}&to=${SEED_TO}`);
    expect(res.status).toBe(200);
    // A report is the house's private data and changes with every feeding: no shared or stale copies.
    expect(res.headers.get("cache-control")).toBe("no-store");
    const r = ReportSummarySchema.parse(await res.json());
    expect(r).toMatchObject({ timeZone: SEED_TZ, bucket: "day" });
    expect(r.totals).toMatchObject({ feedings: 154, amountMg: 5_240_000 });
    expect(r.periods).toHaveLength(31);
    // Measured, not asserted: workerd in vitest is not a CPU budget, but a regression shows up here.
    const t0 = performance.now();
    await (await summary(s, `from=${SEED_FROM}&to=${SEED_TO}`)).text();
    console.log(`[reports] one summary over the seeded month: ${(performance.now() - t0).toFixed(1)} ms`);
  });

  it("filters by cat and buckets by week on request", async () => {
    const r = ReportSummarySchema.parse(await (await summary(s, `from=${SEED_FROM}&to=${SEED_TO}&cat=${SEED_CATS[0].id}&bucket=week`)).json());
    expect(r.totals.feedings).toBe(62);
    expect(r.periods.map((p) => p.key)[0]).toBe("2026-02-23");
  });

  it("ignores deleted feedings and keeps a removed cat's history", async () => {
    const extraId = crypto.randomUUID();
    await s.fetchAuthed("/api/feedings", { method: "POST", body: JSON.stringify([asFeeding({ id: extraId, catId: SEED_CATS[0].id, fedAt: Date.UTC(2026, 2, 10, 10), amountMg: 9_000 })]) });
    await s.fetchAuthed(`/api/feedings/${extraId}`, { method: "DELETE" });
    await s.fetchAuthed(`/api/cats/${SEED_CATS[1].id}`, { method: "DELETE" });
    const r = ReportSummarySchema.parse(await (await summary(s, `from=${SEED_FROM}&to=${SEED_TO}`)).json());
    expect(r.totals.feedings).toBe(154);
    expect(r.cats.find((c) => c.id === SEED_CATS[1].id)).toMatchObject({ name: "Luna", deleted: true });
    expect((await summary(s, `from=${SEED_FROM}&to=${SEED_TO}&cat=${SEED_CATS[1].id}`)).status).toBe(200);
  });

  it("rejects hostile ranges", async () => {
    for (const qs of ["from=2026-02-30&to=2026-03-01", "from=2026-03-10&to=2026-03-01", "from=2020-01-01&to=2026-01-01", "from=2026-03-01&to=2026-03-31&bucket=year", "from=2026-03-01&to=2026-03-31&cat=nope"]) {
      const res = await summary(s, qs);
      expect(res.status, qs).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_request" });
    }
    // Outside 2000..2999: "9999-12-31" made dayBoundsMs step into "+010000-01-01" and throw (a 500).
    for (const [qs, path] of [["from=9999-12-01&to=9999-12-31", "from"], ["from=1999-12-01&to=1999-12-31", "from"], ["from=2999-12-01&to=3000-01-01", "to"]] as const) {
      const res = await summary(s, qs);
      expect(res.status, qs).toBe(400);
      expect(await res.json(), qs).toMatchObject({ error: "invalid_request", issues: expect.arrayContaining([expect.objectContaining({ path: [path] })]) });
      expect((await s.fetchAuthed(`/api/reports/export.csv?${qs}`)).status, qs).toBe(400);
    }
    expect((await summary(s, "from=2999-12-01&to=2999-12-31")).status).toBe(200);
    // Hour buckets are capped at MAX_HOUR_BUCKET_DAYS (7): 8 days of hours is 192 periods.
    const hours = await summary(s, "from=2026-03-01&to=2026-03-08&bucket=hour");
    expect(hours.status).toBe(400);
    expect(await hours.json()).toMatchObject({ error: "invalid_request", issues: [{ path: ["bucket"] }] });
    expect((await summary(s, "from=2026-03-01&to=2026-03-07&bucket=hour")).status).toBe(200);
    expect((await summary(s, `from=2026-03-01&to=2026-03-31&cat=${crypto.randomUUID()}`)).status).toBe(404);
  });

  it("is scoped to the caller's house and needs a token", async () => {
    const other = await signup();
    const r = ReportSummarySchema.parse(await (await summary(other, `from=${SEED_FROM}&to=${SEED_TO}`)).json());
    expect(r.totals.feedings).toBe(0);
    expect((await fetch_("/api/reports/summary?from=2026-03-01&to=2026-03-31")).status).toBe(401);
  });

  it("exports the range as CSV", async () => {
    // Storage is isolated per test (vitest-pool-workers), so the removal above was rolled back: remove Luna here.
    expect((await s.fetchAuthed(`/api/cats/${SEED_CATS[1].id}`, { method: "DELETE" })).status).toBe(204);
    const res = await s.fetchAuthed(`/api/reports/export.csv?from=${SEED_FROM}&to=${SEED_TO}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv; ?charset=utf-8/);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="feedme2-${SEED_FROM}-${SEED_TO}.csv"`);
    const text = await res.text();
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("date,time,cat,amount,unit,grams,entered_value,entered_unit,source,note");
    expect(lines).toHaveLength(1 + 154);
    // Luna's rows stay, labelled.
    expect(lines[1]).toBe("2026-03-01,07:00,Luna (removed),30,g,30,30,g,web,");
  });
});
