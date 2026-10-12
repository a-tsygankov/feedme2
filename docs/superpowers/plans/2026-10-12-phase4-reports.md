# Phase 4: Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Reports page and per-cat charts: feedings and amounts per period, cans consumed, intervals, an hour-of-day heatmap, month → week → day → feeding drill-down and CSV export, all bucketed in the house's time zone.

**Architecture:** Calendar math and the aggregation are pure TypeScript in `shared/` (one implementation for Worker and browser, snapshot-tested). The Worker resolves a local-date range in the house zone, reads the feedings once from D1 and returns one `ReportSummary`; CSV is a second Worker route. The webapp renders a hand-rolled SVG chart family themed by the token layer (gigsy has no chart library; no new dependency) and keeps the report filters in the URL.

**Tech Stack:** TypeScript, zod, Hono 4 + Drizzle on D1, vitest (`@cloudflare/vitest-pool-workers` for backend), React 18 + react-router-dom 6 + TanStack Query 5, Tailwind 3 token layer, Playwright (Pixel 7).

**Spec:** `docs/superpowers/specs/2026-09-20-feedme2-design.md` — §1.3 (Reports, Cat page), §3.3 (`/api/reports/*`), §4.1 (`/reports` route), §4.4 (Reports UX), §7 row "4 Reports" (exit test: e2e over a seeded month; snapshot tests for aggregations).

**Out of scope (firmware is paused, see `handoff.md`):** anything under `firmware/`, OTA, the web firmware page.

## Global Constraints

- Stack verbatim from gigsy: React 18, Vite 5, TypeScript, react-router-dom 6, Tailwind 3 with the `R G B` token layer and `data-theme` dark mode, TanStack Query 5, vitest + jsdom, Playwright on the Pixel 7 profile. **No new runtime dependency** (no chart library): `.npmrc` has `min-release-age=7`, and gigsy has none.
- **No `dark:` Tailwind utilities.** Colours come from `webapp/src/styles/tokens/*.css` via `rgb(var(--c-…))` / semantic variables; per-cat series use the cat's own colour from `CAT_COLORS` (`shared/src/api.ts`), which the dashboard already uses to tint cards.
- Every report bucket, bound and label is in the **house's** IANA time zone (`house.settings.timezone`), never the browser's. Weeks start on **Monday**.
- Integers only in D1 (epoch-ms, milligrams). API JSON may carry derived floats (`cans`, means) rounded to 2 decimals.
- Backend errors: validation failures are `{error:"invalid_request", issues:[{path,message}]}` (400); every other error is `{error:"<snake_case>"}`.
- Every query is scoped by `houseId` taken only from `requireHouse()`.
- "Never show a selector with one option" (spec §4.3): the cat filter is hidden when the house has one cat.
- Reports are online-only (spec §4.2 lists only feedings as offline writes); offline shows "Reports need a connection".
- Versioning: `shared/` changes bump webapp and worker; `backend/` bumps worker; `webapp/` bumps webapp; `.github/` and docs bump nothing (`scripts/version_rules.py`). The pre-commit hook does the bump; stage the bumped `package.json` files.
- Commits: lowercase conventional with scope (`feat(webapp): …`), staged by explicit pathspec (never `git add -A`), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. With parallel agents, commit under the lock: `until mkdir .git/feedme2-commit.lock 2>/dev/null; do sleep 10; done` … `rmdir .git/feedme2-commit.lock`.
- TDD: failing test first. Comments explain *why*.

## Review Focus

1. **A DST day** (Europe/Berlin 2026-03-29 has 23 hours; 2026-10-25 has 25): day buckets must still be one bucket per calendar day, hour buckets must not invent or drop feedings, and the day's bounds must be the real local midnights. → Task 1 (`zone.test.ts`) and Task 2 (`reports.test.ts` "DST day").
2. **A phone in another zone than the house** (house Europe/Berlin, browser Asia/Tokyo): "today", week bounds and every label follow the house. → Task 1 (zone math takes the zone explicitly), Task 4 (server resolves bounds), Task 6 (`todayKey` takes the house zone), Task 9 (e2e runs with `timezoneId: "Asia/Tokyo"`).
3. **Removed cats and deleted feedings**: soft-deleted feedings never count; feedings of a soft-deleted cat still count and show the cat as "Name (removed)", and that cat is not offered in the filter. → Task 4 (route test), Task 7 (filter test).
4. **Empty and tiny data**: an empty range, a cat with one feeding (no interval), a cat filter with no feedings: totals are 0, interval stats are `null`, charts render an empty state, never `NaN`/`Infinity`. → Task 2, Task 5, Task 7.
5. **Hostile ranges**: `to` before `from`, impossible dates (`2026-02-30`), a 10-year custom range, a feeding exactly at a bound (from-day's midnight is inclusive; the instant after to-day ends is exclusive). → Task 1 (`parseDateKey`), Task 4 (400s and the 732-day cap), Task 2 (bound inclusivity).

## File Structure

```
.github/workflows/deploy.yml                     Task 0 (deploy guards; no lost diffs)
scripts/test_workflow_guards.py                  Task 0 (pins the guards)
shared/src/zone.ts            + zone.test.ts      Task 1 calendar math in an IANA zone
shared/src/reports.ts         + reports.test.ts   Task 2 schemas + aggregateReport (+ __snapshots__)
shared/test-fixtures/report-month.json            Task 2 seeded month (not fixtures/: that dir bumps firmware)
shared/src/csv.ts             + csv.test.ts       Task 3 RFC 4180 + formula-injection guard, feedings CSV rows
shared/src/index.ts                               Tasks 1–3 exports
webapp/src/lib/day-boundary.ts                    Task 1 delegates to shared zone math
backend/src/repos/feedings.ts                     Task 4 listForReport / listForExport
backend/src/repos/cats.ts                         Task 4 listIncludingDeleted (if absent)
backend/src/routes/reports.ts + test/reports.test.ts   Task 4
backend/src/index.ts                              Task 4 mount /api/reports
webapp/src/components/charts/{BarChart,Heatmap,ChartFrame}.tsx + tests   Task 5
webapp/src/lib/report-filters.ts + test           Task 6 URL state, presets, shift, drill targets
webapp/src/lib/api-client.ts, hooks/use-report.ts Task 7
webapp/src/screens/Reports.tsx + test, components/report/*  Task 7
webapp/src/App.tsx, components/TabBar.tsx         Task 7
webapp/src/screens/CatPage.tsx, components/report/CatTrends.tsx + test   Task 8
webapp/e2e/reports.spec.ts, e2e/helpers/seed.ts   Task 9
handoff.md, README.md, docs/handoffs/2026-10-12-phase4-execution-handoff.md   Tasks 0, 10
```

Task order and parallelism: 0 ∥ 1; 2 and 3 after 1 (2 ∥ 3); 4 after 2 and 3; 5 ∥ 6 after 1 (webapp only); 7 after 4, 5, 6; 8 after 7; 9 after 7; 10 last.

---

## Task 0: CI hygiene and the handoff after Phase 2

Two CI faults surfaced at the Phase 2 merge: (a) `workflow_dispatch` deploys whatever ref it runs on to production; (b) with `cancel-in-progress: true` and a per-push `paths-filter` diff, a run cancelled by the next push loses its changes — the Phase 2a merge (#2) was cancelled by the #3 merge and never deployed until a manual dispatch on main.

**Files:**
- Create: `scripts/test_workflow_guards.py`
- Modify: `.github/workflows/deploy.yml` (concurrency at ~line 20; `changes` job ~25–54; `backend-deploy` `if:` ~102; `webapp-deploy` `if:` ~307)
- Modify: `handoff.md` (Phase line: Phase 2a + 2b merged and deployed 2026-10-12, production worker 0.1.39 / schema `0002_devices_pairings.sql`; firmware paused because the device may change; Phase 4 next; drop the "in review" wording; add a log entry)

**Interfaces:** none (CI only).

- [ ] **Step 1: Failing guard tests** — `scripts/test_workflow_guards.py` (runs under `python -m unittest discover -s scripts`; PyYAML is not guaranteed in CI, so check the job blocks as text):

```python
"""Pins the deploy workflow's safety rules (incident 2026-10-12: PR #2's merge run was
cancelled by PR #3's and its backend never deployed; a manual dispatch deploys any ref)."""
import re
import unittest
from pathlib import Path

WF = (Path(__file__).resolve().parent.parent / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")


def job_block(name: str) -> str:
    m = re.search(rf"^  {re.escape(name)}:\n(.*?)(?=^  [a-z0-9-]+:\n|\Z)", WF, re.S | re.M)
    if not m:
        raise AssertionError(f"job {name} not found")
    return m.group(1)


class DeployGuards(unittest.TestCase):
    def test_deploy_jobs_only_deploy_main_on_dispatch(self):
        for job in ("backend-deploy", "webapp-deploy"):
            block = job_block(job)
            self.assertRegex(block, r"github\.event_name == 'workflow_dispatch' && github\.ref == 'refs/heads/main'", job)

    def test_pushes_to_main_are_not_cancelled(self):
        self.assertRegex(WF, r"cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}")

    def test_push_diff_starts_at_last_successful_run(self):
        block = job_block("changes")
        self.assertIn("fetch-depth: 0", block)
        self.assertIn("id: lastgood", block)
        self.assertRegex(block, r"base: \$\{\{ steps\.lastgood\.outputs\.sha")
        self.assertIn("actions: read", block)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run** `python -m unittest scripts.test_workflow_guards -v` → 3 failures.

- [ ] **Step 3: Edit `deploy.yml`.**

Concurrency:
```yaml
concurrency:
  group: deploy-${{ github.ref }}
  # PR runs are superseded by newer pushes; main runs must all finish, or a cancelled
  # run's changes never deploy (2026-10-12: PR #2's merge run was cancelled by PR #3's).
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

`changes` job: add `permissions: { contents: read, actions: read, pull-requests: read }` (merge with any existing entries), give its checkout `fetch-depth: 0` (add `actions/checkout@v4` if the job has none), and insert before the `dorny/paths-filter@v3` step:
```yaml
      - name: Last commit main deployed successfully
        id: lastgood
        if: github.event_name == 'push'
        env:
          GH_TOKEN: ${{ github.token }}
        # Diff from the last green push/dispatch run instead of the previous push, so a
        # run that was queued, failed or cancelled leaves its changes to the next one.
        run: |
          sha=$(gh run list --repo "$GITHUB_REPOSITORY" --workflow deploy.yml --branch main \
            --status success --limit 30 --json headSha,event \
            --jq '[.[] | select(.event == "push" or .event == "workflow_dispatch")][0].headSha // ""')
          if [ -z "$sha" ] || ! git cat-file -e "$sha^{commit}" 2>/dev/null; then sha="${{ github.event.before }}"; fi
          echo "sha=$sha" >> "$GITHUB_OUTPUT"
```
and give the filter step `base: ${{ steps.lastgood.outputs.sha || '' }}` (empty on PRs, where paths-filter keeps using the PR base).

Deploy jobs: replace the dispatch clause in both `backend-deploy` and `webapp-deploy`:
```yaml
    if: |
      needs.backend-test.result == 'success' &&
      ((github.event_name == 'push' && needs.changes.outputs.backend == 'true') ||
       (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'))
```
(same shape with `webapp-build` / `webapp` for `webapp-deploy`). Check every other job that writes to production for the same clause.

- [ ] **Step 4: Run** `python -m unittest discover -s scripts` → all green (42 + 3). Parse the YAML once: `python -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"` (scratch venv if PyYAML is missing).

- [ ] **Step 5: handoff.md** as listed under Files.

- [ ] **Step 6: Commit**
```bash
git add .github/workflows/deploy.yml scripts/test_workflow_guards.py handoff.md
git commit -m "ci: deploy only main on dispatch; main runs are not cancelled and diff from the last green run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 1: Calendar math in the house's zone (`shared/src/zone.ts`)

**Files:**
- Create: `shared/src/zone.ts`, `shared/src/zone.test.ts`
- Modify: `shared/src/index.ts` (`export * from "./zone.ts";`), `webapp/src/lib/day-boundary.ts` (delegate; keep its export and its device-local fallback), `webapp/src/lib/day-boundary.test.ts` (must stay green unchanged)

**Interfaces:**
- Produces (pure; `tz` is an IANA name; an invalid `tz` falls back to `"UTC"`):
  - `type DateKey = string` — `"YYYY-MM-DD"`.
  - `parseDateKey(k: string): { y: number; m: number; d: number } | null` — null for malformed or impossible dates (`2026-02-30`).
  - `isDateKey(k: string): boolean`.
  - `addDays(k: DateKey, n: number): DateKey`, `addMonths(k: DateKey, n: number): DateKey` (clamps the day: `2026-01-31` + 1 month → `2026-02-28`).
  - `weekdayOf(k: DateKey): number` — Monday 0 … Sunday 6.
  - `startOfWeek(k: DateKey): DateKey` (Monday), `startOfMonth(k: DateKey): DateKey`, `daysBetween(a: DateKey, b: DateKey): number` (b − a).
  - `zonedParts(ms: number, tz: string): { y; m; d; h; mi; s; weekday }` (numbers; weekday Monday 0).
  - `dateKeyOf(ms: number, tz: string): DateKey`.
  - `midnightMs(k: DateKey, tz: string): number` — the first instant of local day `k` (handles zones whose midnight is skipped by DST).
  - `dayBoundsMs(from: DateKey, to: DateKey, tz: string): { fromMs: number; toMs: number }` — `[midnight(from), midnight(to + 1))`.

- [ ] **Step 1: Failing tests** `shared/src/zone.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addDays, addMonths, dateKeyOf, dayBoundsMs, daysBetween, isDateKey, midnightMs, parseDateKey, startOfMonth, startOfWeek, weekdayOf, zonedParts } from "./zone.ts";

describe("date keys", () => {
  it("parses real dates only", () => {
    expect(parseDateKey("2026-03-29")).toEqual({ y: 2026, m: 3, d: 29 });
    expect(parseDateKey("2026-02-30")).toBeNull();
    expect(parseDateKey("2026-3-9")).toBeNull();
    expect(isDateKey("2024-02-29")).toBe(true);
    expect(isDateKey("2025-02-29")).toBe(false);
  });
  it("does pure calendar arithmetic", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
  });
  it("starts weeks on Monday", () => {
    expect(weekdayOf("2026-10-12")).toBe(0); // a Monday
    expect(weekdayOf("2026-10-18")).toBe(6);
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12");
    expect(startOfWeek("2026-10-12")).toBe("2026-10-12");
    expect(startOfMonth("2026-10-18")).toBe("2026-10-01");
  });
});

describe("instants in a zone", () => {
  it("reads wall-clock parts in the given zone, not the host's", () => {
    const ms = Date.UTC(2026, 2, 28, 23, 30); // 00:30 on the 29th in Berlin (CET, +1)
    expect(dateKeyOf(ms, "Europe/Berlin")).toBe("2026-03-29");
    expect(dateKeyOf(ms, "America/New_York")).toBe("2026-03-28");
    expect(zonedParts(ms, "Asia/Tokyo")).toMatchObject({ y: 2026, m: 3, d: 29, h: 8, mi: 30, weekday: 6 });
  });
  it("finds midnight across a spring-forward day (23 h)", () => {
    const start = midnightMs("2026-03-29", "Europe/Berlin");
    const next = midnightMs("2026-03-30", "Europe/Berlin");
    expect(start).toBe(Date.UTC(2026, 2, 28, 23));
    expect(next - start).toBe(23 * 3_600_000);
  });
  it("finds midnight across a fall-back day (25 h)", () => {
    expect(midnightMs("2026-10-26", "Europe/Berlin") - midnightMs("2026-10-25", "Europe/Berlin")).toBe(25 * 3_600_000);
  });
  it("returns the first instant of a day whose midnight does not exist", () => {
    // America/Santiago springs forward at 24:00 on 2026-09-05, so the 6th starts at 01:00 local.
    const ms = midnightMs("2026-09-06", "America/Santiago");
    expect(dateKeyOf(ms, "America/Santiago")).toBe("2026-09-06");
    expect(dateKeyOf(ms - 1, "America/Santiago")).toBe("2026-09-05");
  });
  it("gives half-open day bounds", () => {
    const b = dayBoundsMs("2026-03-01", "2026-03-31", "Europe/Berlin");
    expect(b.fromMs).toBe(midnightMs("2026-03-01", "Europe/Berlin"));
    expect(b.toMs).toBe(midnightMs("2026-04-01", "Europe/Berlin"));
  });
  it("falls back to UTC for an unknown zone instead of throwing", () => {
    expect(dateKeyOf(Date.UTC(2026, 0, 1, 23), "Not/AZone")).toBe("2026-01-01");
  });
});
```

(If the Santiago transition date differs in the runtime's tz database, pick the 2026 September transition the runtime reports — `Intl` is the source of truth — and keep the assertion shape.)

- [ ] **Step 2: Run** `pnpm --filter @feedme2/shared test -- zone` → FAIL (module missing).

- [ ] **Step 3: Implement** `shared/src/zone.ts`:

```ts
/**
 * Calendar math in an explicit IANA zone. Reports, the dashboard's "today" and the Worker
 * must agree on day boundaries, so this is the one implementation (spec §1.4: the house's
 * zone, not the phone's). Date keys are plain calendar dates; only zonedParts, dateKeyOf
 * and midnightMs touch a zone.
 */
export type DateKey = string;

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function parseDateKey(k: string): { y: number; m: number; d: number } | null {
  const m = KEY.exec(k);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? { y, m: mo, d } : null;
}
export const isDateKey = (k: string): boolean => parseDateKey(k) !== null;

function utcOf(k: DateKey): number {
  const p = parseDateKey(k);
  if (!p) throw new RangeError(`bad date key ${k}`);
  return Date.UTC(p.y, p.m - 1, p.d);
}
const keyOfUtc = (ms: number): DateKey => new Date(ms).toISOString().slice(0, 10);

export const addDays = (k: DateKey, n: number): DateKey => keyOfUtc(utcOf(k) + n * DAY_MS);
export const daysBetween = (a: DateKey, b: DateKey): number => Math.round((utcOf(b) - utcOf(a)) / DAY_MS);
export function addMonths(k: DateKey, n: number): DateKey {
  const p = parseDateKey(k);
  if (!p) throw new RangeError(`bad date key ${k}`);
  const first = new Date(Date.UTC(p.y, p.m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return keyOfUtc(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(p.d, last)));
}
export const weekdayOf = (k: DateKey): number => (new Date(utcOf(k)).getUTCDay() + 6) % 7;
export const startOfWeek = (k: DateKey): DateKey => addDays(k, -weekdayOf(k));
export const startOfMonth = (k: DateKey): DateKey => `${k.slice(0, 8)}01`;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      // h23: some engines print "24" for midnight under the default hour cycle.
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    } catch {
      f = fmt("UTC");
    }
    fmtCache.set(tz, f);
  }
  return f;
}

export function zonedParts(ms: number, tz: string) {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const y = p.year!, m = p.month!, d = p.day!;
  return { y, m, d, h: p.hour!, mi: p.minute!, s: p.second!, weekday: (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 };
}

export function dateKeyOf(ms: number, tz: string): DateKey {
  const p = zonedParts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function offsetAt(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

export function midnightMs(k: DateKey, tz: string): number {
  const wall = utcOf(k);
  // Two passes converge across a transition: first the offset at the wall time, then at the guess.
  let guess = wall - offsetAt(wall, tz);
  guess = wall - offsetAt(guess, tz);
  // A skipped midnight (e.g. America/Santiago) leaves the guess on the previous day: step to the first real hour.
  for (let i = 0; i < 3 && dateKeyOf(guess, tz) < k; i++) guess += 3_600_000;
  return guess;
}

export function dayBoundsMs(from: DateKey, to: DateKey, tz: string): { fromMs: number; toMs: number } {
  return { fromMs: midnightMs(from, tz), toMs: midnightMs(addDays(to, 1), tz) };
}
```

`webapp/src/lib/day-boundary.ts` becomes (keep the device-local fallback for an unusable zone, which `day-boundary.test.ts` pins):
```ts
import { dateKeyOf, midnightMs } from "@feedme2/shared";

function startOfLocalDay(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Epoch-ms of 00:00 on the house's calendar day containing nowMs (spec §1.4: "Today" means the same on every device). */
export function startOfDayInZone(nowMs: number, timeZone: string): number {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    return startOfLocalDay(nowMs);
  }
  return midnightMs(dateKeyOf(nowMs, timeZone), timeZone);
}
```

- [ ] **Step 4: Run** `pnpm --filter @feedme2/shared test && pnpm --filter webapp test -- day-boundary && pnpm -r typecheck` → green.

- [ ] **Step 5: Commit** (the hook bumps webapp and worker for `shared/`; stage both package.json files)
```bash
git add shared/src/zone.ts shared/src/zone.test.ts shared/src/index.ts webapp/src/lib/day-boundary.ts webapp/package.json backend/package.json
git commit -m "feat(shared): calendar math in the house zone with dst-safe midnights; dashboard day boundary uses it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 2: Report schemas, the seeded month, and `aggregateReport` (`shared/src/reports.ts`)

**Files:**
- Create: `shared/src/reports.ts`, `shared/src/reports.test.ts` (writes `shared/src/__snapshots__/reports.test.ts.snap` on first run; commit it)
- Create: `shared/src/testing/seed-month.ts` — deterministic March 2026 data used by this task, Task 4 (backend) and Task 9 (e2e). **Not** exported from `shared/src/index.ts` (test-only; import it by relative path).
- Modify: `shared/src/index.ts` (`export * from "./reports.ts";`)

**Interfaces:**
- Consumes (Task 1): `DateKey`, `isDateKey`, `addDays`, `daysBetween`, `startOfWeek`, `dateKeyOf`, `zonedParts`, `dayBoundsMs`. From `api.ts`: `FoodUnitSchema`, `FoodUnit`, `CAT_COLORS` (cat colour is a plain string here so a removed cat with an old colour still parses).
- Produces:
  - `MAX_REPORT_DAYS = 732`.
  - `DateKeySchema = z.string().refine(isDateKey, "expected a real date YYYY-MM-DD")`.
  - `ReportBucketSchema = z.enum(["hour", "day", "week", "month"])`; `type ReportBucket`.
  - `defaultBucket(from: DateKey, to: DateKey): ReportBucket` — 1 day → `hour`; ≤ 92 days → `day`; ≤ 400 → `week`; else `month`.
  - `INTERVAL_BUCKETS: ReadonlyArray<{ label: string; minSec: number; maxSec: number | null }>` — `<2 h`, `2–4 h`, `4–6 h`, `6–8 h`, `8–12 h`, `12–24 h`, `24 h+` (min inclusive, max exclusive).
  - `ReportSummarySchema` and `type ReportSummary` (shape below).
  - `interface ReportFeeding { id: string; catId: string; fedAt: number; amountMg: number }`.
  - `interface ReportCat { id: string; name: string; color: string; deleted: boolean }`.
  - `interface AggregateInput { feedings: ReportFeeding[]; cats: ReportCat[]; from: DateKey; to: DateKey; timeZone: string; bucket: ReportBucket; foodUnit: FoodUnit; canSizeMg: number }`.
  - `aggregateReport(input: AggregateInput): ReportSummary` — pure; ignores feedings outside `dayBoundsMs(from, to, timeZone)`.
  - `periodKeyOf(ms: number, bucket: ReportBucket, tz: string): string` and `periodKeys(from: DateKey, to: DateKey, bucket: ReportBucket): string[]` — keys: hour `YYYY-MM-DDTHH`, day `YYYY-MM-DD`, week = that week's Monday `YYYY-MM-DD` (may precede `from`), month `YYYY-MM`.
  - From `testing/seed-month.ts`: `SEED_TZ = "Europe/Berlin"`, `SEED_FROM = "2026-03-01"`, `SEED_TO = "2026-03-31"`, `randomSalt(): string` (8 hex), `seedMonth(salt = "5eed0000"): { cats: [{ id, name: "Mochi", color: "#4CAF50" }, { id, name: "Luna", color: "#2196F3" }]; feedings: ReportFeeding[] }` (ids are v4 UUIDs built from the salt; fedAt from `midnightMs` + local wall times), and the default-salt views `SEED_CATS` and `seedMonthFeedings()` for the pure tests. Suites that seed a real database (backend, e2e) use `seedMonth(randomSalt())`.

`ReportSummarySchema`:
```ts
export const ReportSummarySchema = z.object({
  from: DateKeySchema,
  to: DateKeySchema,
  timeZone: z.string(),
  bucket: ReportBucketSchema,
  foodUnit: FoodUnitSchema,
  canSizeMg: z.number().int().positive(),
  cats: z.array(z.object({ id: z.string(), name: z.string(), color: z.string(), deleted: z.boolean() })),
  totals: z.object({
    feedings: z.number().int().nonnegative(),
    amountMg: z.number().int().nonnegative(),
    cans: z.number().nonnegative(),                     // amountMg / canSizeMg, 2 decimals
    meanIntervalSec: z.number().int().nullable(),        // over every per-cat interval in range
    longestGap: z.object({ catId: z.string(), sec: z.number().int(), fromMs: z.number().int(), toMs: z.number().int() }).nullable(),
  }),
  perCat: z.array(z.object({
    catId: z.string(), feedings: z.number().int(), amountMg: z.number().int(),
    meanIntervalSec: z.number().int().nullable(), longestGapSec: z.number().int().nullable(),
  })),
  periods: z.array(z.object({
    key: z.string(), feedings: z.number().int(), amountMg: z.number().int(),
    byCat: z.record(z.string(), z.object({ feedings: z.number().int(), amountMg: z.number().int() })),
  })),
  intervals: z.array(z.object({ label: z.string(), minSec: z.number().int(), maxSec: z.number().int().nullable(), count: z.number().int() })),
  heatmap: z.array(z.array(z.number().int()).length(24)).length(7),   // [weekday Mon=0][hour 0..23]
});
```

Rules the implementation must follow (each pinned below):
- `cats` lists every live cat of the input plus every removed cat that has a feeding in range, in input order. A removed cat with no feeding in range is omitted.
- Intervals are between consecutive feedings **of the same cat inside the range** (sorted by `fedAt`, ties by id). A cat with one feeding has `meanIntervalSec: null`, `longestGapSec: null`. Means are `Math.round` of the mean in seconds.
- `periods` contains every key of `periodKeys(from, to, bucket)` in order, empty ones with zeros and `byCat: {}`.
- Hour buckets use the local wall hour: on a 25-hour day both 02:xx hours share key `T02`; on a 23-hour day `T02` stays empty.
- `heatmap[weekday][hour]` counts feedings by local weekday and wall hour.

- [ ] **Step 1: The seeded month** `shared/src/testing/seed-month.ts`:

```ts
/**
 * March 2026 in Europe/Berlin, the spec's Phase 4 exit fixture (spec §7: "e2e over a seeded month").
 * Includes the spring-forward day (2026-03-29, 23 h). Mochi eats at 07:30 and 19:00 (40 g); Luna at
 * 07:00, 13:00 and 20:00 (30 g) except 2026-03-15 20:00, which is missing, so Luna's longest gap is
 * 13:00 on the 15th to 07:00 on the 16th (18 h). Totals: 62 + 92 = 154 feedings, 5 240 g.
 */
import { addDays, midnightMs, type DateKey } from "../zone.ts";
import type { ReportFeeding } from "../reports.ts";

export const SEED_TZ = "Europe/Berlin";
export const SEED_FROM: DateKey = "2026-03-01";
export const SEED_TO: DateKey = "2026-03-31";

/**
 * Cat and feeding ids are global primary keys in D1, so a suite that seeds the same database
 * twice (e2e reruns) passes a fresh 8-hex `salt`; ids stay valid lowercase v4 UUIDs.
 */
export const randomSalt = (): string => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");

export interface SeedCat { id: string; name: string; color: string }

/** A tuple, so SEED_CATS[0] and [1] type as defined under noUncheckedIndexedAccess. */
export function seedMonth(salt = "5eed0000"): { cats: [SeedCat, SeedCat]; feedings: ReportFeeding[] } {
  const cats: [SeedCat, SeedCat] = [
    { id: `${salt}-0000-4000-8000-000000000001`, name: "Mochi", color: "#4CAF50" },
    { id: `${salt}-0000-4000-8000-000000000002`, name: "Luna", color: "#2196F3" },
  ];
  return { cats, feedings: buildFeedings(salt, cats[0].id, cats[1].id) };
}

/** Default-salt views for the pure tests. */
export const SEED_CATS = seedMonth().cats;
export const seedMonthFeedings = (): ReportFeeding[] => seedMonth().feedings;

// A function declaration, not a const: SEED_CATS above runs seedMonth() at module load (hoisting).
function at(day: DateKey, h: number, mi: number): number {
  // Local wall time on `day`; none of the seed times fall in a DST gap (02:00–03:00).
  const mid = midnightMs(day, SEED_TZ);
  const guess = mid + (h * 60 + mi) * 60_000;
  const next = midnightMs(addDays(day, 1), SEED_TZ);
  // After a spring-forward the wall clock runs one hour ahead of mid + elapsed.
  return next - mid === 23 * 3_600_000 && h >= 3 ? guess - 3_600_000 : guess;
}

function buildFeedings(salt: string, mochi: string, luna: string): ReportFeeding[] {
  const out: ReportFeeding[] = [];
  let n = 0;
  for (let i = 0; i < 31; i++) {
    const day = addDays(SEED_FROM, i);
    const push = (catId: string, h: number, mi: number, amountMg: number) =>
      out.push({ id: `${salt}-0001-4000-8000-${String(++n).padStart(12, "0")}`, catId, fedAt: at(day, h, mi), amountMg });
    push(mochi, 7, 30, 40_000);
    push(mochi, 19, 0, 40_000);
    push(luna, 7, 0, 30_000);
    push(luna, 13, 0, 30_000);
    if (day !== "2026-03-15") push(luna, 20, 0, 30_000);
  }
  return out;
}
```

- [ ] **Step 2: Failing tests** `shared/src/reports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { aggregateReport, defaultBucket, periodKeys, ReportSummarySchema, type AggregateInput } from "./reports.ts";
import { dayBoundsMs, midnightMs } from "./zone.ts";
import { SEED_CATS, SEED_FROM, SEED_TO, SEED_TZ, seedMonthFeedings } from "./testing/seed-month.ts";

const cats = SEED_CATS.map((c) => ({ ...c, deleted: false }));
const base = (over: Partial<AggregateInput> = {}): AggregateInput => ({
  feedings: seedMonthFeedings(), cats, from: SEED_FROM, to: SEED_TO, timeZone: SEED_TZ,
  bucket: "day", foodUnit: "g", canSizeMg: 155_922, ...over,
});

describe("aggregateReport over the seeded month", () => {
  const r = aggregateReport(base());

  it("parses under its own schema", () => expect(() => ReportSummarySchema.parse(r)).not.toThrow());

  it("totals", () => {
    expect(r.totals.feedings).toBe(154);
    expect(r.totals.amountMg).toBe(5_240_000);
    expect(r.totals.cans).toBe(33.61);
    expect(r.totals.longestGap).toMatchObject({ catId: SEED_CATS[1].id, sec: 18 * 3600 });
  });

  it("per cat, with the DST night shortening one interval", () => {
    const mochi = r.perCat.find((p) => p.catId === SEED_CATS[0].id)!;
    expect(mochi).toMatchObject({ feedings: 62, amountMg: 2_480_000, longestGapSec: 12.5 * 3600 });
    // First 07:30 CET on the 1st to last 19:00 CEST on the 31st is 730.5 h over 61 intervals.
    expect(mochi.meanIntervalSec).toBe(Math.round((730.5 * 3600) / 61));
  });

  it("one period per calendar day, the gap day has 4 feedings", () => {
    expect(r.periods).toHaveLength(31);
    expect(r.periods[14]).toMatchObject({ key: "2026-03-15", feedings: 4 });
    expect(r.periods[28]).toMatchObject({ key: "2026-03-29", feedings: 5 });
  });

  it("heatmap counts every feeding by local wall hour", () => {
    expect(r.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(154);
    expect(r.heatmap.reduce((a, row) => a + row[7]!, 0)).toBe(62); // 07:00 and 07:30
    expect(r.heatmap.reduce((a, row) => a + row[2]!, 0)).toBe(0);
  });

  it("interval histogram", () => {
    const by = Object.fromEntries(r.intervals.map((b) => [b.label, b.count]));
    expect(by["12–24 h"]).toBeGreaterThan(0);
    expect(r.intervals.reduce((a, b) => a + b.count, 0)).toBe(61 + 91);
  });

  it("matches the snapshot", () => expect(r).toMatchSnapshot());
});

describe("buckets", () => {
  it("chooses a default by span", () => {
    expect(defaultBucket("2026-03-29", "2026-03-29")).toBe("hour");
    expect(defaultBucket("2026-03-01", "2026-03-31")).toBe("day");
    expect(defaultBucket("2026-01-01", "2026-12-31")).toBe("week");
    expect(defaultBucket("2025-01-01", "2026-12-31")).toBe("month");
  });
  it("lists week keys by Monday and month keys by month", () => {
    expect(periodKeys("2026-03-01", "2026-03-31", "week")).toEqual(["2026-02-23", "2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"]);
    expect(periodKeys("2026-01-15", "2026-03-02", "month")).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
  it("hour buckets on the 23-hour day keep 24 keys and an empty T02", () => {
    const r = aggregateReport(base({ from: "2026-03-29", to: "2026-03-29", bucket: "hour" }));
    expect(r.periods).toHaveLength(24);
    expect(r.periods.find((p) => p.key === "2026-03-29T02")!.feedings).toBe(0);
    expect(r.totals.feedings).toBe(5);
  });
  it("hour buckets on the 25-hour day merge both 02:xx hours", () => {
    const day = "2026-10-25";
    const mid = midnightMs(day, SEED_TZ);
    const feedings = [
      { id: "a", catId: SEED_CATS[0].id, fedAt: mid + 2.5 * 3_600_000, amountMg: 1000 }, // 02:30 CEST
      { id: "b", catId: SEED_CATS[0].id, fedAt: mid + 3.5 * 3_600_000, amountMg: 1000 }, // 02:30 CET
    ];
    const r = aggregateReport(base({ feedings, from: day, to: day, bucket: "hour" }));
    expect(r.periods.find((p) => p.key === `${day}T02`)!.feedings).toBe(2);
  });
});

describe("edges", () => {
  it("counts the from-midnight instant and drops the instant the range ends", () => {
    const { fromMs, toMs } = dayBoundsMs("2026-03-10", "2026-03-10", SEED_TZ);
    const f = (id: string, fedAt: number) => ({ id, catId: SEED_CATS[0].id, fedAt, amountMg: 1000 });
    const r = aggregateReport(base({ feedings: [f("in1", fromMs), f("in2", toMs - 1), f("out", toMs)], from: "2026-03-10", to: "2026-03-10" }));
    expect(r.totals.feedings).toBe(2);
  });
  it("is all zeros and nulls on an empty range", () => {
    const r = aggregateReport(base({ feedings: [] }));
    expect(r.totals).toEqual({ feedings: 0, amountMg: 0, cans: 0, meanIntervalSec: null, longestGap: null });
    expect(r.perCat.every((p) => p.meanIntervalSec === null && p.longestGapSec === null)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });
  it("lists a removed cat only when it has feedings in range", () => {
    const removed = [{ ...cats[0]!, deleted: false }, { ...cats[1]!, deleted: true }];
    expect(aggregateReport(base({ cats: removed })).cats.map((c) => c.name)).toEqual(["Mochi", "Luna"]);
    const onlyMochi = seedMonthFeedings().filter((f) => f.catId === SEED_CATS[0].id);
    expect(aggregateReport(base({ cats: removed, feedings: onlyMochi })).cats.map((c) => c.name)).toEqual(["Mochi"]);
  });
});
```

- [ ] **Step 3: Run** `pnpm --filter @feedme2/shared test -- reports` → FAIL (module missing).

- [ ] **Step 4: Implement** `shared/src/reports.ts`:

```ts
/**
 * Report aggregation (spec §1.3 Reports, §4.4). Pure, so the Worker serves it and the tests
 * snapshot it; every bucket is a calendar unit in the house zone (spec §1.4).
 */
import { z } from "zod";
import { FoodUnitSchema, type FoodUnit } from "./api.ts";
import { addDays, dateKeyOf, dayBoundsMs, daysBetween, isDateKey, startOfWeek, zonedParts, type DateKey } from "./zone.ts";

export const MAX_REPORT_DAYS = 732;
export const DateKeySchema = z.string().refine(isDateKey, "expected a real date YYYY-MM-DD");
export const ReportBucketSchema = z.enum(["hour", "day", "week", "month"]);
export type ReportBucket = z.infer<typeof ReportBucketSchema>;

const H = 3600;
export const INTERVAL_BUCKETS = [
  { label: "<2 h", minSec: 0, maxSec: 2 * H },
  { label: "2–4 h", minSec: 2 * H, maxSec: 4 * H },
  { label: "4–6 h", minSec: 4 * H, maxSec: 6 * H },
  { label: "6–8 h", minSec: 6 * H, maxSec: 8 * H },
  { label: "8–12 h", minSec: 8 * H, maxSec: 12 * H },
  { label: "12–24 h", minSec: 12 * H, maxSec: 24 * H },
  { label: "24 h+", minSec: 24 * H, maxSec: null },
] as const;

// ReportSummarySchema exactly as in the Interfaces block above.

export interface ReportFeeding { id: string; catId: string; fedAt: number; amountMg: number }
export interface ReportCat { id: string; name: string; color: string; deleted: boolean }
export interface AggregateInput {
  feedings: ReportFeeding[]; cats: ReportCat[]; from: DateKey; to: DateKey; timeZone: string;
  bucket: ReportBucket; foodUnit: FoodUnit; canSizeMg: number;
}

export function defaultBucket(from: DateKey, to: DateKey): ReportBucket {
  const n = daysBetween(from, to) + 1;
  return n <= 1 ? "hour" : n <= 92 ? "day" : n <= 400 ? "week" : "month";
}

const pad = (n: number) => String(n).padStart(2, "0");

export function periodKeyOf(ms: number, bucket: ReportBucket, tz: string): string {
  const day = dateKeyOf(ms, tz);
  if (bucket === "hour") return `${day}T${pad(zonedParts(ms, tz).h)}`;
  if (bucket === "day") return day;
  if (bucket === "week") return startOfWeek(day);
  return day.slice(0, 7);
}

export function periodKeys(from: DateKey, to: DateKey, bucket: ReportBucket): string[] {
  const keys: string[] = [];
  if (bucket === "hour") {
    for (let d = from; d <= to; d = addDays(d, 1)) for (let h = 0; h < 24; h++) keys.push(`${d}T${pad(h)}`);
  } else if (bucket === "day") {
    for (let d = from; d <= to; d = addDays(d, 1)) keys.push(d);
  } else if (bucket === "week") {
    for (let d = startOfWeek(from); d <= to; d = addDays(d, 7)) keys.push(d);
  } else {
    for (let d = `${from.slice(0, 7)}-01`; d <= to; ) {
      keys.push(d.slice(0, 7));
      const [y, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))];
      d = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
    }
  }
  return keys;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function aggregateReport(i: AggregateInput): ReportSummary {
  const { fromMs, toMs } = dayBoundsMs(i.from, i.to, i.timeZone);
  const inRange = i.feedings
    .filter((f) => f.fedAt >= fromMs && f.fedAt < toMs)
    .sort((a, b) => a.fedAt - b.fedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const periods = new Map(periodKeys(i.from, i.to, i.bucket).map((k) => [k, { key: k, feedings: 0, amountMg: 0, byCat: {} as Record<string, { feedings: number; amountMg: number }> }]));
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const byCat = new Map<string, ReportFeeding[]>();
  let amountMg = 0;
  for (const f of inRange) {
    amountMg += f.amountMg;
    const p = periods.get(periodKeyOf(f.fedAt, i.bucket, i.timeZone));
    if (p) {
      p.feedings++; p.amountMg += f.amountMg;
      const c = (p.byCat[f.catId] ??= { feedings: 0, amountMg: 0 });
      c.feedings++; c.amountMg += f.amountMg;
    }
    const zp = zonedParts(f.fedAt, i.timeZone);
    const row = heatmap[zp.weekday]!;
    row[zp.h] = (row[zp.h] ?? 0) + 1;
    (byCat.get(f.catId) ?? byCat.set(f.catId, []).get(f.catId)!).push(f);
  }

  const intervals = INTERVAL_BUCKETS.map((b) => ({ label: b.label, minSec: b.minSec, maxSec: b.maxSec, count: 0 }));
  const all: number[] = [];
  let longestGap: ReportSummary["totals"]["longestGap"] = null;
  const perCat = i.cats
    .filter((c) => !c.deleted || byCat.has(c.id))
    .map((c) => {
      const fs = byCat.get(c.id) ?? [];
      const gaps: number[] = [];
      for (let k = 1; k < fs.length; k++) {
        const sec = Math.round((fs[k]!.fedAt - fs[k - 1]!.fedAt) / 1000);
        gaps.push(sec);
        all.push(sec);
        intervals.find((b) => sec >= b.minSec && (b.maxSec === null || sec < b.maxSec))!.count++;
        if (!longestGap || sec > longestGap.sec) longestGap = { catId: c.id, sec, fromMs: fs[k - 1]!.fedAt, toMs: fs[k]!.fedAt };
      }
      return {
        catId: c.id,
        feedings: fs.length,
        amountMg: fs.reduce((a, f) => a + f.amountMg, 0),
        meanIntervalSec: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
        longestGapSec: gaps.length ? Math.max(...gaps) : null,
      };
    });

  return {
    from: i.from, to: i.to, timeZone: i.timeZone, bucket: i.bucket, foodUnit: i.foodUnit, canSizeMg: i.canSizeMg,
    cats: i.cats.filter((c) => !c.deleted || byCat.has(c.id)).map(({ id, name, color, deleted }) => ({ id, name, color, deleted })),
    totals: {
      feedings: inRange.length,
      amountMg,
      cans: round2(amountMg / i.canSizeMg),
      meanIntervalSec: all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null,
      longestGap,
    },
    perCat,
    periods: [...periods.values()],
    intervals,
    heatmap,
  };
}
```

(Feedings of a cat id that is not in `i.cats` still count in totals, periods and heatmap but have no `perCat` row; the route always passes every cat of the house, so that only guards against a race with a cat delete.)

- [ ] **Step 5: Run** `pnpm --filter @feedme2/shared test` → green, snapshot written. Read the snapshot once and check it holds 31 periods and 7×24 heatmap rows before committing it.

- [ ] **Step 6: Commit**
```bash
git add shared/src/reports.ts shared/src/reports.test.ts shared/src/__snapshots__/reports.test.ts.snap shared/src/testing/seed-month.ts shared/src/index.ts webapp/package.json backend/package.json
git commit -m "feat(shared): report aggregation in the house zone with a seeded-month snapshot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: CSV (`shared/src/csv.ts`)

**Files:**
- Create: `shared/src/csv.ts`, `shared/src/csv.test.ts`
- Modify: `shared/src/index.ts` (`export * from "./csv.ts";`)

**Interfaces:**
- Consumes: `dateKeyOf`, `zonedParts` (Task 1), `fromMg` (`units.ts`), `FoodUnit`.
- Produces:
  - `csvCell(v: string | number | null): string` — numbers bare; `null` → empty; strings quoted when they contain `"`, `,`, CR or LF (quotes doubled); a string starting with `=`, `+`, `-`, `@`, TAB or CR gets a leading `'` first (formula injection guard, ported from gigsy `webapp/src/lib/csv.ts`).
  - `toCsv(rows: Array<Array<string | number | null>>): string` — CRLF line ends, trailing CRLF, **no** BOM (the route adds it).
  - `FEEDINGS_CSV_HEADERS = ["date", "time", "cat", "amount", "unit", "grams", "entered_value", "entered_unit", "source", "note"] as const`.
  - `interface CsvFeeding { fedAt: number; catName: string; amountMg: number; enteredUnit: FoodUnit; enteredValue: string; source: "device" | "web"; note: string | null }`.
  - `feedingCsvRow(f: CsvFeeding, tz: string, unit: FoodUnit, canSizeMg: number): Array<string | number | null>` — date and `HH:MM` in the house zone; `amount` = `fromMg` rounded to 2 decimals in the house unit; `unit` = house unit; `grams` = `amountMg / 1000` rounded to 3 decimals.

- [ ] **Step 1: Failing tests** `shared/src/csv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { csvCell, feedingCsvRow, FEEDINGS_CSV_HEADERS, toCsv } from "./csv.ts";

describe("csv", () => {
  it("quotes only when needed and keeps numbers bare", () => {
    expect(csvCell("Mochi")).toBe("Mochi");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(-3.5)).toBe("-3.5");
    expect(csvCell(null)).toBe("");
  });
  it("defuses spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });
  it("joins with CRLF and ends with one", () => {
    expect(toCsv([["a", 1], ["b", null]])).toBe("a,1\r\nb,\r\n");
  });
  it("renders a feeding in the house zone and unit", () => {
    const row = feedingCsvRow(
      { fedAt: Date.UTC(2026, 2, 28, 23, 5), catName: "Mochi", amountMg: 77_961, enteredUnit: "can", enteredValue: "1/2", source: "device", note: null },
      "Europe/Berlin", "can", 155_922,
    );
    expect(row).toEqual(["2026-03-29", "00:05", "Mochi", 0.5, "can", 77.961, "1/2", "can", "device", null]);
    expect(FEEDINGS_CSV_HEADERS).toHaveLength(row.length);
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `shared/src/csv.ts`:

```ts
/** CSV for exports (spec §1.3 "CSV export"). RFC 4180 quoting plus gigsy's formula-injection guard. */
import type { FoodUnit } from "./api.ts";
import { fromMg } from "./units.ts";
import { dateKeyOf, zonedParts } from "./zone.ts";

const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: string | number | null): string {
  if (v === null) return "";
  if (typeof v === "number") return String(v);
  // A spreadsheet runs a cell starting with these as a formula; the apostrophe makes it text.
  const s = FORMULA_START.test(v) ? `'${v}` : v;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: Array<Array<string | number | null>>): string => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export const FEEDINGS_CSV_HEADERS = ["date", "time", "cat", "amount", "unit", "grams", "entered_value", "entered_unit", "source", "note"] as const;

export interface CsvFeeding { fedAt: number; catName: string; amountMg: number; enteredUnit: FoodUnit; enteredValue: string; source: "device" | "web"; note: string | null }

export function feedingCsvRow(f: CsvFeeding, tz: string, unit: FoodUnit, canSizeMg: number): Array<string | number | null> {
  const p = zonedParts(f.fedAt, tz);
  const time = `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
  return [
    dateKeyOf(f.fedAt, tz), time, f.catName,
    Math.round(fromMg(f.amountMg, unit, canSizeMg) * 100) / 100, unit,
    Math.round(f.amountMg) / 1000, f.enteredValue, f.enteredUnit, f.source, f.note,
  ];
}
```

- [ ] **Step 4: Run** `pnpm --filter @feedme2/shared test && pnpm -r typecheck` → green. **Step 5: Commit**
```bash
git add shared/src/csv.ts shared/src/csv.test.ts shared/src/index.ts webapp/package.json backend/package.json
git commit -m "feat(shared): csv cells with the formula guard and a feedings row in the house zone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: `/api/reports/summary` and `/api/reports/export.csv`

**Files:**
- Create: `backend/src/routes/reports.ts`, `backend/test/reports.test.ts`
- Modify: `backend/src/repos/feedings.ts` (two read methods), `backend/src/repos/cats.ts` (`listIncludingDeleted`), `backend/src/index.ts` (mount next to the feedings router)

**Interfaces:**
- Consumes: `aggregateReport`, `defaultBucket`, `DateKeySchema`, `ReportBucketSchema`, `MAX_REPORT_DAYS`, `ReportSummary` (Task 2); `toCsv`, `feedingCsvRow`, `FEEDINGS_CSV_HEADERS` (Task 3); `dayBoundsMs`, `daysBetween` (Task 1); `requireHouse`, `AuthVars`, `validationHook`, `db`, `HousesRepo`, `toApiHouse` (existing).
- Produces:
  - `CatsRepo.listIncludingDeleted(houseId: string): Promise<Row[]>` — same order as `list`.
  - `FeedingsRepo.listForReport(houseId: string, fromMs: number, toMs: number, catId?: string): Promise<Array<{ id: string; catId: string; fedAt: number; amountMg: number }>>` — live rows, `fromMs <= fed_at < toMs`, ordered by `fed_at, id`; selects only those four columns.
  - `FeedingsRepo.listForExport(houseId, fromMs, toMs, catId?)` — same filter, full rows.
  - `GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD[&cat=<uuid>][&bucket=hour|day|week|month]` → 200 `ReportSummary`.
  - `GET /api/reports/export.csv?from=&to=[&cat=]` → 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="feedme2-<from>-<to>.csv"`, body = UTF-8 BOM + `toCsv([FEEDINGS_CSV_HEADERS, ...rows])`.
  - Errors: 400 `invalid_request` (bad date, `to` before `from` at path `to`, span over 732 days at path `to`, bad bucket, bad uuid); 404 `{error:"cat_not_found"}` when `cat` is not a cat of this house (removed cats are fine); 401 without a house token.

- [ ] **Step 1: Failing tests** `backend/test/reports.test.ts` (seed through the real API like `feedings.test.ts`; POST batches of at most 100; the seed is in the past, so the 5-minute future guard never fires):

```ts
import { ReportSummarySchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";
import { randomSalt, SEED_FROM, SEED_TO, SEED_TZ, seedMonth } from "../../shared/src/testing/seed-month.ts";

type Session = Awaited<ReturnType<typeof signup>>;
const asFeeding = (f: { id: string; catId: string; fedAt: number; amountMg: number }) => ({ ...f, enteredUnit: "g", enteredValue: String(f.amountMg / 1000) });
const seed = seedMonth(randomSalt());
const SEED_CATS = seed.cats;

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
    const r = ReportSummarySchema.parse(await res.json());
    expect(r).toMatchObject({ timeZone: SEED_TZ, bucket: "day" });
    expect(r.totals).toMatchObject({ feedings: 154, amountMg: 5_240_000 });
    expect(r.periods).toHaveLength(31);
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
    expect((await summary(s, `from=2026-03-01&to=2026-03-31&cat=${crypto.randomUUID()}`)).status).toBe(404);
  });

  it("is scoped to the caller's house and needs a token", async () => {
    const other = await signup();
    const r = ReportSummarySchema.parse(await (await summary(other, `from=${SEED_FROM}&to=${SEED_TO}`)).json());
    expect(r.totals.feedings).toBe(0);
    expect((await fetch_("/api/reports/summary?from=2026-03-01&to=2026-03-31")).status).toBe(401);
  });

  it("exports the range as CSV", async () => {
    const res = await s.fetchAuthed(`/api/reports/export.csv?from=${SEED_FROM}&to=${SEED_TO}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv; ?charset=utf-8/);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="feedme2-${SEED_FROM}-${SEED_TO}.csv"`);
    const text = await res.text();
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("date,time,cat,amount,unit,grams,entered_value,entered_unit,source,note");
    expect(lines).toHaveLength(1 + 154);
    // Luna was removed by the test above; her rows stay, labelled.
    expect(lines[1]).toBe("2026-03-01,07:00,Luna (removed),30,g,30,30,g,web,");
  });
});
```
`fetch_` is the unauthenticated request helper: use `SELF.fetch(new Request("http://x" + path))` from `cloudflare:test` (see how `test/helpers/api.ts` builds requests and reuse its base URL).

- [ ] **Step 2: Run** `pnpm --filter backend test -- reports` → FAIL (404 on the route).

- [ ] **Step 3: Implement.** Repos (Drizzle, same style as `page()`):
```ts
// cats.ts
listIncludingDeleted(houseId: string): Promise<Row[]> {
  // Reports keep a removed cat's history (spec §1.3); same order as list().
  return this.db.query.cats.findMany({ where: eq(cats.houseId, houseId), orderBy: [asc(cats.sortOrder), asc(cats.createdAt), asc(cats.id)] });
}

// feedings.ts
private rangeWhere(houseId: string, fromMs: number, toMs: number, catId?: string) {
  const conds = [eq(feedings.houseId, houseId), isNull(feedings.deletedAt), gte(feedings.fedAt, fromMs), lt(feedings.fedAt, toMs)];
  if (catId) conds.push(eq(feedings.catId, catId));
  return and(...conds);
}
listForReport(houseId: string, fromMs: number, toMs: number, catId?: string) {
  return this.db.select({ id: feedings.id, catId: feedings.catId, fedAt: feedings.fedAt, amountMg: feedings.amountMg })
    .from(feedings).where(this.rangeWhere(houseId, fromMs, toMs, catId)).orderBy(asc(feedings.fedAt), asc(feedings.id));
}
listForExport(houseId: string, fromMs: number, toMs: number, catId?: string): Promise<Row[]> {
  return this.db.query.feedings.findMany({ where: this.rangeWhere(houseId, fromMs, toMs, catId), orderBy: [asc(feedings.fedAt), asc(feedings.id)] });
}
```

`backend/src/routes/reports.ts`:
```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { aggregateReport, dayBoundsMs, daysBetween, DateKeySchema, defaultBucket, FEEDINGS_CSV_HEADERS, feedingCsvRow, MAX_REPORT_DAYS, ReportBucketSchema, toCsv } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { CatsRepo } from "../repos/cats.ts";
import { FeedingsRepo } from "../repos/feedings.ts";
import { HousesRepo, toApiHouse } from "../repos/houses.ts";
import { validationHook } from "../validation.ts";

const RangeQuery = z.object({
  from: DateKeySchema,
  to: DateKeySchema,
  cat: z.string().uuid().optional(),
  bucket: ReportBucketSchema.optional(),
}).superRefine((q, ctx) => {
  if (q.to < q.from) ctx.addIssue({ code: "custom", path: ["to"], message: "before from" });
  else if (daysBetween(q.from, q.to) + 1 > MAX_REPORT_DAYS) ctx.addIssue({ code: "custom", path: ["to"], message: `range longer than ${MAX_REPORT_DAYS} days` });
});

export const reportsRouter = new Hono<{ Bindings: Bindings } & AuthVars>()
  .use("*", requireHouse())
  .get("/summary", zValidator("query", RangeQuery, validationHook), async (c) => {
    const q = c.req.valid("query");
    const d = db(c.env.DB);
    const house = toApiHouse((await new HousesRepo(d).findById(c.var.houseId))!);
    const cats = await new CatsRepo(d).listIncludingDeleted(c.var.houseId);
    if (q.cat && !cats.some((x) => x.id === q.cat)) return c.json({ error: "cat_not_found" }, 404);
    const tz = house.settings.timezone;
    const { fromMs, toMs } = dayBoundsMs(q.from, q.to, tz);
    const feedings = await new FeedingsRepo(d).listForReport(c.var.houseId, fromMs, toMs, q.cat);
    return c.json(aggregateReport({
      feedings,
      cats: cats.filter((x) => !q.cat || x.id === q.cat).map((x) => ({ id: x.id, name: x.name, color: x.color, deleted: x.deletedAt !== null })),
      from: q.from, to: q.to, timeZone: tz, bucket: q.bucket ?? defaultBucket(q.from, q.to),
      foodUnit: house.settings.foodUnit, canSizeMg: house.settings.canSizeMg,
    }));
  })
  .get("/export.csv", zValidator("query", RangeQuery, validationHook), async (c) => {
    const q = c.req.valid("query");
    const d = db(c.env.DB);
    const house = toApiHouse((await new HousesRepo(d).findById(c.var.houseId))!);
    const cats = await new CatsRepo(d).listIncludingDeleted(c.var.houseId);
    if (q.cat && !cats.some((x) => x.id === q.cat)) return c.json({ error: "cat_not_found" }, 404);
    const names = new Map(cats.map((x) => [x.id, x.deletedAt === null ? x.name : `${x.name} (removed)`]));
    const tz = house.settings.timezone;
    const { fromMs, toMs } = dayBoundsMs(q.from, q.to, tz);
    const rows = (await new FeedingsRepo(d).listForExport(c.var.houseId, fromMs, toMs, q.cat)).map((f) =>
      feedingCsvRow({ fedAt: f.fedAt, catName: names.get(f.catId) ?? "?", amountMg: f.amountMg, enteredUnit: f.enteredUnit, enteredValue: f.enteredValue, source: f.source, note: f.note }, tz, house.settings.foodUnit, house.settings.canSizeMg));
    // BOM: Excel otherwise reads UTF-8 cat names as Latin-1.
    return c.body("﻿" + toCsv([[...FEEDINGS_CSV_HEADERS], ...rows]), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="feedme2-${q.from}-${q.to}.csv"`,
      "cache-control": "no-store",
    });
  });
```
Mount in `index.ts`: `.route("/api/reports", reportsRouter)` next to `/api/feedings`. Adjust names to what the repos actually export (`toApiHouse`, the Row `deletedAt` field, `x.color`) and say so in the commit body if they differ.

- [ ] **Step 4: Run** `pnpm --filter backend test && pnpm --filter backend typecheck` → green.

- [ ] **Step 5: Commit** (worker bump)
```bash
git add backend/src/routes/reports.ts backend/test/reports.test.ts backend/src/repos/feedings.ts backend/src/repos/cats.ts backend/src/index.ts backend/package.json
git commit -m "feat(backend): report summary and csv export over a house-zone date range

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 5: The SVG chart family (`webapp/src/components/charts/`)

Spec §4.4 asks for "a `<FeedingChart kind=…>` family". gigsy has no chart library, so these are small SVG components on the token layer: no dependency, no `dark:` utilities, readable by screen readers through a hidden data table.

**Files:**
- Create: `webapp/src/components/charts/ChartFrame.tsx`, `BarChart.tsx`, `Heatmap.tsx`, `FeedingChart.tsx` (the `kind` switch), `charts.test.tsx`

**Interfaces:**
- Produces:
  - `ChartFrame({ title, empty, emptyText = "No feedings in this range", table, children, testId }: { title: string; empty: boolean; emptyText?: string; table: { headers: string[]; rows: string[][] }; children: ReactNode; testId: string })` — `<figure data-testid={testId}>` with `<figcaption>`; when `empty`, shows `emptyText` instead of `children`; always renders `<table className="sr-only">` with the data.
  - `interface Series { id: string; label: string; color: string }` (colour is any CSS colour: a cat hex or `rgb(var(--c-emerald-600))`).
  - `interface BarPoint { key: string; label: string; values: Record<string, number> }`.
  - `BarChart({ title, series, points, format, onSelect, height = 140, testId }: { title: string; series: Series[]; points: BarPoint[]; format: (n: number) => string; onSelect?: (key: string) => void; height?: number; testId: string })` — stacked bars in `series` order; `viewBox="0 0 {points.length * 12} {height}"`, `preserveAspectRatio="none"`, width 100%; each bar column is a `<g data-testid={"bar-" + key}>` with one `<rect>` per non-zero series and a `<title>` "label: format(total)"; when `onSelect` is set the `<g>` has `role="button"`, `tabIndex={0}`, an `aria-label` and fires on click and Enter/Space. Axis labels below the plot as HTML (every `Math.ceil(points.length / 8)`-th label) so text does not stretch. Empty when every total is 0.
  - `Heatmap({ title, cells, testId }: { title: string; cells: number[][]; testId: string })` — 7 × 24 `<rect>`s, fill `rgb(var(--c-emerald-600))`, `fillOpacity` = `0.08 + 0.92 * count / max` (0 when count is 0), rows labelled Mon…Sun, hour labels 0, 6, 12, 18. Empty when max is 0.
  - `FeedingChart(props: { kind: "bars"; …BarChart props } | { kind: "heatmap"; …Heatmap props })`.
  - Constant `ACCENT = "rgb(var(--c-emerald-600))"` exported from `BarChart.tsx` for single-series charts.

- [ ] **Step 1: Failing tests** `charts.test.tsx` (vitest + jsdom + @testing-library/react, as `HungerRing.test.tsx` does):

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BarChart } from "./BarChart.tsx";
import { Heatmap } from "./Heatmap.tsx";

const series = [{ id: "a", label: "Mochi", color: "#4CAF50" }, { id: "b", label: "Luna", color: "#2196F3" }];
const points = [
  { key: "2026-03-01", label: "1", values: { a: 2, b: 3 } },
  { key: "2026-03-02", label: "2", values: { a: 1, b: 0 } },
  { key: "2026-03-03", label: "3", values: {} },
];

describe("BarChart", () => {
  it("stacks series and scales to the tallest column", () => {
    render(<BarChart title="Feedings" series={series} points={points} format={String} height={100} testId="c" />);
    const first = screen.getByTestId("bar-2026-03-01").querySelectorAll("rect");
    expect(first).toHaveLength(2);
    const heights = [...first].map((r) => Number(r.getAttribute("height")));
    expect(heights.reduce((a, b) => a + b, 0)).toBeCloseTo(100 * 0.9, 0); // tallest column fills the plot (10% headroom)
    expect(screen.getByTestId("bar-2026-03-03").querySelectorAll("rect")).toHaveLength(0);
    expect(screen.getByTestId("c").innerHTML).not.toMatch(/NaN|Infinity/);
  });
  it("is reachable without sight: a data table with every value", () => {
    render(<BarChart title="Feedings" series={series} points={points} format={String} testId="c" />);
    const table = within(screen.getByTestId("c")).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(1 + points.length);
    expect(table.textContent).toContain("Mochi");
  });
  it("drills on click and on Enter", () => {
    const onSelect = vi.fn();
    render(<BarChart title="Feedings" series={series} points={points} format={String} onSelect={onSelect} testId="c" />);
    fireEvent.click(screen.getByTestId("bar-2026-03-01"));
    fireEvent.keyDown(screen.getByTestId("bar-2026-03-02"), { key: "Enter" });
    expect(onSelect.mock.calls).toEqual([["2026-03-01"], ["2026-03-02"]]);
  });
  it("shows the empty state when there is nothing to draw", () => {
    render(<BarChart title="Feedings" series={series} points={[points[2]!]} format={String} testId="c" />);
    expect(screen.getByText("No feedings in this range")).toBeTruthy();
  });
});

describe("Heatmap", () => {
  it("draws 168 cells with opacity by count", () => {
    const cells = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    cells[0]![7] = 4; cells[6]![19] = 2;
    render(<Heatmap title="By hour" cells={cells} testId="h" />);
    const rects = screen.getByTestId("h").querySelectorAll("svg rect");
    expect(rects).toHaveLength(168);
    expect(Number(rects[7]!.getAttribute("fill-opacity"))).toBe(1);
    expect(Number(rects[6 * 24 + 19]!.getAttribute("fill-opacity"))).toBeCloseTo(0.54, 2);
    expect(Number(rects[0]!.getAttribute("fill-opacity"))).toBe(0);
  });
  it("is empty when every cell is zero", () => {
    render(<Heatmap title="By hour" cells={Array.from({ length: 7 }, () => new Array<number>(24).fill(0))} testId="h" />);
    expect(screen.getByText("No feedings in this range")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter webapp test -- charts` → FAIL.

- [ ] **Step 3: Implement.** `BarChart.tsx` core (ChartFrame and Heatmap follow the same shape):

```tsx
import type { KeyboardEvent, ReactNode } from "react";
import { ChartFrame } from "./ChartFrame.tsx";

export const ACCENT = "rgb(var(--c-emerald-600))";
export interface Series { id: string; label: string; color: string }
export interface BarPoint { key: string; label: string; values: Record<string, number> }

const COL = 12;   // viewBox units per column
const BAR = 9;    // bar width inside a column
const HEADROOM = 0.9;

export function BarChart({ title, series, points, format, onSelect, height = 140, testId }: {
  title: string; series: Series[]; points: BarPoint[]; format: (n: number) => string;
  onSelect?: (key: string) => void; height?: number; testId: string;
}) {
  const totals = points.map((p) => series.reduce((a, s) => a + (p.values[s.id] ?? 0), 0));
  const max = Math.max(0, ...totals);
  const scale = max > 0 ? (height * HEADROOM) / max : 0;
  const every = Math.max(1, Math.ceil(points.length / 8));
  const table = {
    headers: ["", ...series.map((s) => s.label)],
    rows: points.map((p) => [p.label, ...series.map((s) => format(p.values[s.id] ?? 0))]),
  };
  const activate = (key: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(key); }
  };
  return (
    <ChartFrame title={title} empty={max === 0} table={table} testId={testId}>
      <svg viewBox={`0 0 ${points.length * COL} ${height}`} preserveAspectRatio="none" className="h-36 w-full" aria-hidden="true">
        {points.map((p, i) => {
          let y = height;
          const rects: ReactNode[] = [];
          for (const s of series) {
            const v = p.values[s.id] ?? 0;
            if (v <= 0) continue;
            const h = v * scale;
            y -= h;
            rects.push(<rect key={s.id} x={i * COL + (COL - BAR) / 2} y={y} width={BAR} height={h} fill={s.color} rx={1.5} />);
          }
          return (
            <g key={p.key} data-testid={`bar-${p.key}`}
              {...(onSelect ? { role: "button", tabIndex: 0, "aria-label": `${p.label}: ${format(totals[i]!)}`, onClick: () => onSelect(p.key), onKeyDown: activate(p.key), className: "cursor-pointer" } : {})}>
              <title>{`${p.label}: ${format(totals[i]!)}`}</title>
              {/* Full-height hit area so a short bar is still easy to tap. */}
              <rect x={i * COL} y={0} width={COL} height={height} fill="transparent" />
              {rects}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500" aria-hidden="true">
        {points.filter((_, i) => i % every === 0).map((p) => <span key={p.key}>{p.label}</span>)}
      </div>
    </ChartFrame>
  );
}
```
Note the hit-area `<rect>`: the test counts rects inside `bar-<key>`, so select the visible ones with `rect:not([fill="transparent"])` in the test, or render the hit area as a `<rect>` sibling outside the counted set — pick one and keep the test honest (the stacked-height assertion must sum only the visible bars).

`ChartFrame.tsx`:
```tsx
export function ChartFrame({ title, empty, emptyText = "No feedings in this range", table, children, testId }: {...}) {
  return (
    <figure data-testid={testId} className="rounded-xl border border-slate-200 bg-white p-3">
      <figcaption className="mb-2 text-sm font-medium text-slate-700">{title}</figcaption>
      {empty ? <p className="py-8 text-center text-sm text-slate-500">{emptyText}</p> : children}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr>{table.headers.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
      </table>
    </figure>
  );
}
```
(The test counts `1 + points.length` rows: the header row plus one per point.)

`Heatmap.tsx`: `viewBox="0 0 240 70"`, cell 10 × 10, `<rect fill={ACCENT} fill-opacity=…>` row-major (weekday × hour), `<title>` per cell "Mon 07:00 – 4", labels as HTML around the SVG; table: headers `["", "0", …, "23"]`, rows per weekday.

- [ ] **Step 4: Run** `pnpm --filter webapp test -- charts && pnpm --filter webapp typecheck` → green.

- [ ] **Step 5: Commit**
```bash
git add webapp/src/components/charts webapp/package.json
git commit -m "feat(webapp): svg bar chart and heatmap on the token layer with data-table fallbacks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Report filters in the URL (`webapp/src/lib/report-filters.ts`)

**Files:**
- Create: `webapp/src/lib/report-filters.ts`, `webapp/src/lib/report-filters.test.ts`

**Interfaces:**
- Consumes (Task 1/2 via `@feedme2/shared`): `DateKey`, `isDateKey`, `addDays`, `addMonths`, `startOfWeek`, `startOfMonth`, `daysBetween`, `defaultBucket`, `MAX_REPORT_DAYS`, `ReportBucket`.
- Produces:
  - `type ReportRange = "day" | "week" | "month" | "custom"`.
  - `interface ReportFilters { range: ReportRange; from: DateKey; to: DateKey; cat: string | null; unit: "house" | "can" }`.
  - `parseReportFilters(params: URLSearchParams, today: DateKey): ReportFilters` — default range `week` around `today`; `from` normalised to the range start (week → Monday, month → 1st); `to` derived for day/week/month; `custom` needs a valid `from` ≤ `to`, otherwise falls back to the default; a custom span over `MAX_REPORT_DAYS` is cut to `from + MAX_REPORT_DAYS - 1`; `unit=can` is the only non-default unit; unknown params are ignored.
  - `toSearchParams(f: ReportFilters): URLSearchParams` — `range`, `from`, `to` (custom only), `cat` (when set), `unit` (when `can`).
  - `shiftRange(f: ReportFilters, dir: 1 | -1): ReportFilters` — day ±1, week ±7, month ±1 month, custom by its own length.
  - `chartBucket(f: ReportFilters): ReportBucket` — day → `hour`, week → `day`, month → `day`, custom → `defaultBucket(from, to)`.
  - `drillLevel(f: ReportFilters): "week" | "day" | "feedings" | ReportBucket` — what a table row opens: month → `week`, week → `day`, day → `feedings` (no deeper range), custom → its chart bucket.
  - `drillTo(f: ReportFilters, key: string): ReportFilters` — a week key (Monday) → `{range:"week", from:key}`; a day key → `{range:"day", from:key}`; a month key `YYYY-MM` → `{range:"month", from:key + "-01"}`; keeps `cat` and `unit`.
  - `rangeTitle(f: ReportFilters): string` — `"Sun 29 Mar 2026"`, `"23 – 29 Mar 2026"`, `"March 2026"`, `"1 Mar 2026 – 31 Mar 2026"`; formatted from the date key with `Intl.DateTimeFormat("en-GB", { timeZone: "UTC" })` on `Date.UTC(...)` of the key, so the browser zone never shifts a day.

- [ ] **Step 1: Failing tests** `report-filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chartBucket, drillLevel, drillTo, parseReportFilters, rangeTitle, shiftRange, toSearchParams } from "./report-filters.ts";

const parse = (qs: string, today = "2026-03-18") => parseReportFilters(new URLSearchParams(qs), today);

describe("report filters", () => {
  it("defaults to the week around today, Monday-first", () => {
    expect(parse("")).toEqual({ range: "week", from: "2026-03-16", to: "2026-03-22", cat: null, unit: "house" });
  });
  it("normalises from to the range start", () => {
    expect(parse("range=month&from=2026-03-18")).toMatchObject({ from: "2026-03-01", to: "2026-03-31" });
    expect(parse("range=week&from=2026-03-29")).toMatchObject({ from: "2026-03-23", to: "2026-03-29" });
    expect(parse("range=day&from=2026-03-29")).toMatchObject({ from: "2026-03-29", to: "2026-03-29" });
  });
  it("rejects bad custom ranges and caps long ones", () => {
    expect(parse("range=custom&from=2026-03-10&to=2026-03-01")).toMatchObject({ range: "week" });
    expect(parse("range=custom&from=2026-02-30&to=2026-03-01")).toMatchObject({ range: "week" });
    expect(parse("range=custom&from=2020-01-01&to=2026-01-01").to).toBe("2022-01-01"); // from + 731 days (2020 is a leap year)
  });
  it("keeps cat and unit, round-trips through the URL", () => {
    const f = parse("range=custom&from=2026-03-01&to=2026-03-10&cat=c1&unit=can");
    expect(parseReportFilters(toSearchParams(f), "2026-03-18")).toEqual(f);
    expect(toSearchParams(parse("")).toString()).toBe("range=week&from=2026-03-16");
  });
  it("shifts by the range's own size", () => {
    expect(shiftRange(parse("range=month&from=2026-01-01"), 1)).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(shiftRange(parse("range=week&from=2026-03-02"), -1)).toMatchObject({ from: "2026-02-23", to: "2026-03-01" });
    expect(shiftRange(parse("range=custom&from=2026-03-01&to=2026-03-10"), 1)).toMatchObject({ from: "2026-03-11", to: "2026-03-20" });
  });
  it("drills month → week → day → feedings", () => {
    const month = parse("range=month&from=2026-03-01");
    expect(drillLevel(month)).toBe("week");
    const week = drillTo(month, "2026-03-23");
    expect(week).toMatchObject({ range: "week", from: "2026-03-23", to: "2026-03-29" });
    expect(drillLevel(week)).toBe("day");
    const day = drillTo(week, "2026-03-29");
    expect(day).toMatchObject({ range: "day", from: "2026-03-29" });
    expect(drillLevel(day)).toBe("feedings");
    expect(drillTo(parse("range=custom&from=2025-01-01&to=2026-03-01"), "2025-06")).toMatchObject({ range: "month", from: "2025-06-01" });
  });
  it("picks chart buckets", () => {
    expect(chartBucket(parse("range=day&from=2026-03-29"))).toBe("hour");
    expect(chartBucket(parse("range=month&from=2026-03-01"))).toBe("day");
    expect(chartBucket(parse("range=custom&from=2025-01-01&to=2026-03-01"))).toBe("week");
  });
  it("titles ranges without the browser zone shifting a day", () => {
    expect(rangeTitle(parse("range=day&from=2026-03-29"))).toBe("Sun 29 Mar 2026");
    expect(rangeTitle(parse("range=month&from=2026-03-01"))).toBe("March 2026");
    expect(rangeTitle(parse("range=week&from=2026-03-23"))).toBe("23 – 29 Mar 2026");
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** to the interface (pure functions over date keys; the only `Intl` use is `rangeTitle`, formatting `Date.UTC(y, m - 1, d)` with `timeZone: "UTC"`; a week spanning two months reads `"30 Mar – 5 Apr 2026"`, two years `"29 Dec 2025 – 4 Jan 2026"`). **Step 4: Run** → green.

- [ ] **Step 5: Commit**
```bash
git add webapp/src/lib/report-filters.ts webapp/src/lib/report-filters.test.ts webapp/package.json
git commit -m "feat(webapp): report filters in the url with monday weeks, shifting and drill targets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: The Reports screen

**Files:**
- Create: `webapp/src/screens/Reports.tsx`, `webapp/src/screens/Reports.test.tsx`, `webapp/src/hooks/use-report.ts`, `webapp/src/lib/report-format.ts` + `report-format.test.ts`, `webapp/src/lib/download.ts`, `webapp/src/components/report/{ReportControls,ReportTiles,ReportPanels,DrillTable,DayFeedings}.tsx`
- Modify: `webapp/src/lib/api-client.ts` (two methods), `webapp/src/App.tsx` (route `/reports` next to `/settings`, outside `AppShell`, inside `AuthGate`), `webapp/src/components/TabBar.tsx` (a "Reports" tab between Cats and Settings, `data-testid="tab-reports"`)

**Interfaces:**
- Consumes: Task 5 charts, Task 6 filters, `ReportSummarySchema`/`ReportSummary`, `dateKeyOf`, `dayBoundsMs`, `formatAmount`, `startOfWeek` (`@feedme2/shared`), `useHouse()`, `useCats()`, `api.listFeedings`, `AppHeader`, `TabBar`, `NetworkError` (`api-client.ts`).
- Produces:
  - `api.reportSummary(q: { from: string; to: string; cat?: string; bucket?: ReportBucket }): Promise<ReportSummary>` → `GET /api/reports/summary`.
  - `api.exportCsv(q: { from: string; to: string; cat?: string }): Promise<Blob>` → `GET /api/reports/export.csv` (the bearer header rules out a plain link, as gigsy found).
  - `downloadBlob(blob: Blob, filename: string): void` (`lib/download.ts`: object URL + temporary `<a download>`, revoked after click).
  - `reportKey = (f, bucket) => ["report", f.from, f.to, f.cat, bucket] as const` — **not** under `["feedings"]` (the dashboard rewrites that root and expects `Feeding[]`).
  - `useReport(f: ReportFilters)` — `useQuery({ queryKey: reportKey(f, chartBucket(f)), queryFn, staleTime: 60_000 })`.
  - `report-format.ts`: `formatDuration(sec: number | null): string` (`"—"`, `"45 m"`, `"11 h 58 m"`, `"18 h"` — a zero minute part is dropped, `"1 d 2 h"`; seconds are floored, never rounded up into the next minute), `formatTotal(mg: number, unit: "house" | "can", house: { foodUnit; canSizeMg }): string` (house unit via `formatAmount`; `"33.61 cans"` in can mode), `periodLabel(key: string, bucket: ReportBucket): string` (`"07"` for hours, `"29"` for days, `"23 Mar"` for weeks, `"Mar"` for months).

Screen layout (top to bottom), all values from one `ReportSummary`:
1. `AppHeader` titled "Reports"; `ReportControls`: range segmented control (`role="radiogroup"`, four `role="radio"` buttons, gigsy's AppearanceSection pattern), prev / next arrows (`aria-label="Previous"`/`"Next"`) around `rangeTitle(f)`, custom `from`/`to` `<input type="date">` when range is custom, cat `<select data-testid="report-cat">` **only when the house has two or more live cats** (options "All cats" + live cats; removed cats never), unit toggle "House unit / Cans" **only when the house unit is not `can`**, and a "Download CSV" button (`data-testid="report-csv"`).
2. `ReportTiles`: five tiles with `data-testid` `tile-feedings`, `tile-amount`, `tile-cans`, `tile-mean-interval`, `tile-longest-gap`.
3. `ReportPanels`: "Feedings" (stacked by cat, cat colours), "Amount" (stacked by cat, `formatTotal`), "Time between feedings" (interval histogram, `ACCENT`), "By hour" (heatmap). Legend under the first chart: swatch + name, a removed cat as "Luna (removed)". Clicking a bar calls `drillTo(f, key)` when the bucket is `day`, `week` or `month` (hour bars do not drill).
4. `DrillTable` (`data-testid="report-drill"`): one row per drill unit with label, feedings, amount; rows are buttons that navigate with `drillTo`. Month range: rows are the weeks (sum the day periods by `startOfWeek(key)`), week range: the days, custom: the chart periods. Day range: `DayFeedings` lists that day's feedings (`api.listFeedings({ from: fromMs, to: toMs - 1, cat, limit: 200 })` with `dayBoundsMs(f.from, f.from, tz)` — the route's `to` is inclusive, hence `- 1`); rows **oldest first** (the API pages newest first, so reverse), each `data-testid="day-feeding"` with the house-zone time in a `<time dateTime={iso}>HH:MM</time>`, the cat name and the amount.
5. States: loading skeleton; `NetworkError` and no data → "Reports need a connection" (`data-testid="report-offline"`); other error → "Couldn't load the report" with a retry button.

Every navigation writes the URL with `setParams(toSearchParams(next), { replace: false })` so the back button walks back up the drill-down. `today` for `parseReportFilters` is `dateKeyOf(Date.now(), house.settings.timezone)`.

- [ ] **Step 1: Failing tests.** `report-format.test.ts` pins `formatDuration` (`null` → "—", 2700 → "45 m", 43_111 → "11 h 58 m", 64_800 → "18 h", 93_600 → "1 d 2 h"), `formatTotal` (5_240_000 mg in g → `formatAmount`'s output; can mode → "33.61 cans"), `periodLabel` for each bucket.

`Reports.test.tsx` (render inside `QueryClientProvider` + `MemoryRouter initialEntries={["/reports?range=month&from=2026-03-01"]}` with a `Routes` that also renders a `<LocationProbe/>` printing `location.search`; mock `api.reportSummary` with `vi.spyOn` returning `aggregateReport({ ...seedMonth() fields, bucket: "day", timeZone: "Europe/Berlin", foodUnit: "g", canSizeMg: 155_922, from: "2026-03-01", to: "2026-03-31", cats: seedMonth().cats.map((c) => ({ ...c, deleted: false })) })` (import `seedMonth` from `../../../shared/src/testing/seed-month.ts`); mock `useHouse`/`useCats` the way `DevicesSection.test.tsx` mocks its hooks):

```tsx
it("shows the month's totals", async () => {
  renderReports();
  expect(await screen.findByTestId("tile-feedings")).toHaveTextContent("154");
  expect(screen.getByTestId("tile-longest-gap")).toHaveTextContent("18 h");
  expect(api.reportSummary).toHaveBeenCalledWith({ from: "2026-03-01", to: "2026-03-31", bucket: "day" });
});
it("drills from a week row to its days and keeps it in the URL", async () => {
  renderReports();
  fireEvent.click(await within(await screen.findByTestId("report-drill")).findByRole("button", { name: /23 – 29 Mar/ }));
  expect(screen.getByTestId("location")).toHaveTextContent("range=week&from=2026-03-23");
});
it("hides the cat filter with one cat", async () => {
  catsMock.mockReturnValue({ data: [seed.cats[0]] } as never);
  renderReports();
  await screen.findByTestId("tile-feedings");
  expect(screen.queryByTestId("report-cat")).toBeNull();
});
it("offers live cats only and labels a removed one in the legend", async () => {
  catsMock.mockReturnValue({ data: seed.cats } as never);
  vi.mocked(api.reportSummary).mockResolvedValue({ ...monthSummary, cats: [...monthSummary.cats, { id: "ghost", name: "Ghost", color: "#607D8B", deleted: true }] });
  renderReports();
  const select = await screen.findByTestId("report-cat");
  expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["All cats", "Mochi", "Luna"]);
  expect(screen.getByText("Ghost (removed)")).toBeTruthy();
});
it("asks for a connection when offline", async () => {
  vi.spyOn(api, "reportSummary").mockRejectedValue(new NetworkError("offline"));
  renderReports();
  expect(await screen.findByTestId("report-offline")).toBeTruthy();
});
it("downloads the CSV for the current range", async () => {
  const blob = new Blob(["x"]);
  vi.spyOn(api, "exportCsv").mockResolvedValue(blob);
  const dl = vi.spyOn(download, "downloadBlob").mockImplementation(() => {});
  renderReports();
  fireEvent.click(await screen.findByTestId("report-csv"));
  await waitFor(() => expect(dl).toHaveBeenCalledWith(blob, "feedme2-2026-03-01-2026-03-31.csv"));
});
```
Test setup: `const seed = seedMonth();` and `const monthSummary = aggregateReport({ feedings: seed.feedings, cats: seed.cats.map((c) => ({ ...c, deleted: false })), from: "2026-03-01", to: "2026-03-31", timeZone: "Europe/Berlin", bucket: "day", foodUnit: "g", canSizeMg: 155_922 });`; `vi.mock("../hooks/use-cats.ts")` and `vi.mock("../hooks/use-house.ts")` with `catsMock = vi.mocked(useCats)` defaulting to both seed cats and `useHouse` returning a house whose settings carry `timezone: "Europe/Berlin"`, `foodUnit: "g"`, `canSizeMg: 155_922`; `vi.mock("../lib/api-client.ts", async (orig) => ({ ...(await orig()), api: { ...(await orig<typeof import("../lib/api-client.ts")>()).api, reportSummary: vi.fn().mockResolvedValue(monthSummary), exportCsv: vi.fn(), listFeedings: vi.fn() } }))` in the style of `DevicesSection.test.tsx:11`. Check the `NetworkError` constructor signature in `api-client.ts` before using it.

- [ ] **Step 2: Run** `pnpm --filter webapp test -- Reports report-format` → FAIL.

- [ ] **Step 3: Implement** to the layout above. `api-client.ts` additions:
```ts
reportSummary: (q: { from: string; to: string; cat?: string; bucket?: ReportBucket }): Promise<ReportSummary> => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
  return apiFetch(`/api/reports/summary?${params}`).then((r) => json(r, ReportSummarySchema));
},
exportCsv: (q: { from: string; to: string; cat?: string }): Promise<Blob> => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
  return apiFetch(`/api/reports/export.csv?${params}`).then((r) => r.blob());
},
```
Keep each component under ~150 lines; `Reports.tsx` wires state and delegates.

- [ ] **Step 4: Run** `pnpm --filter webapp test && pnpm --filter webapp typecheck && pnpm --filter webapp build` → green. Run the dev stack once (README "local development") and open `/reports` on a house with a few feedings: check light and dark theme, Pixel 7 width (412 px), keyboard focus on bars and rows.

- [ ] **Step 5: Commit**
```bash
git add webapp/src/screens/Reports.tsx webapp/src/screens/Reports.test.tsx webapp/src/hooks/use-report.ts webapp/src/lib/report-format.ts webapp/src/lib/report-format.test.ts webapp/src/lib/download.ts webapp/src/components/report webapp/src/lib/api-client.ts webapp/src/App.tsx webapp/src/components/TabBar.tsx webapp/package.json
git commit -m "feat(webapp): reports page with tiles, charts, drill-down and csv download

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Per-cat trends on the cat page

**Files:**
- Create: `webapp/src/components/report/CatTrends.tsx`, `CatTrends.test.tsx`
- Modify: `webapp/src/screens/CatPage.tsx` (render `<CatTrends cat={cat} />` above the history list)

**Interfaces:**
- Consumes: `useReport`, `ReportFilters`, `toSearchParams` (Tasks 6–7), `BarChart`, `ACCENT` (Task 5), `formatDuration`, `formatTotal` (Task 7), `addDays`, `dateKeyOf`.
- Produces: `CatTrends({ cat }: { cat: Cat })` — `data-testid="cat-trends"`, link `data-testid="cat-trends-link"`; the last 30 house-zone days (`from = addDays(today, -29)`, `to = today`, `range: "custom"`, `cat: cat.id`): an "Amount per day" `BarChart` in the cat's colour, three tiles (feedings, mean interval, longest gap) and a link "Open in Reports" to `/reports?{toSearchParams(filters)}`. Offline with no cached data: a one-line "Trends need a connection" instead of the panel (the history list below keeps working offline).

- [ ] **Step 1: Failing test** `CatTrends.test.tsx`: with `api.reportSummary` mocked, asserts the request (`from` = today − 29 in the house zone, `cat` = the id, `bucket: "day"`), 30 bars, the colour of a visible bar = the cat colour, the link's `href` (`/reports?range=custom&from=…&to=…&cat=…`), and the offline line on `NetworkError`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm --filter webapp test && pnpm --filter webapp typecheck` → green.
- [ ] **Step 5: Commit**
```bash
git add webapp/src/components/report/CatTrends.tsx webapp/src/components/report/CatTrends.test.tsx webapp/src/screens/CatPage.tsx webapp/package.json
git commit -m "feat(webapp): last-30-days trends on the cat page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 9: The exit test — e2e over a seeded month

Spec §7 row 4: "e2e over a seeded month of feedings". The browser runs in **Asia/Tokyo** while the house is in **Europe/Berlin**, and the month contains the spring-forward day, so a bucket computed in the wrong zone fails loudly (Review Focus 1 and 2).

**Files:**
- Create: `webapp/e2e/reports.spec.ts`, `webapp/e2e/helpers/seed.ts`

**Interfaces:**
- Consumes: `requireTestAuth`, `signInAsTestHouse`, `uniqueHouseName` (`e2e/helpers/test-auth.ts`); `seedMonth`, `randomSalt`, `SEED_TZ`, `SEED_FROM`, `SEED_TO` (relative import from `../../shared/src/testing/seed-month.ts`); the Reports screen's test ids (Task 7).
- Produces: `seedReportMonth(page: Page, accessToken: string): Promise<{ cats: [SeedCat, SeedCat] }>` in `e2e/helpers/seed.ts` — PATCH `/api/house` `{ timezone: SEED_TZ }`, POST both cats, POST the 154 feedings in batches of ≤ 100 (`enteredUnit: "g"`, `enteredValue` = grams as a string), asserting 201 each time (`POST /api/feedings` answers 201).

- [ ] **Step 1: The spec** `webapp/e2e/reports.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { requireTestAuth, signInAsTestHouse, uniqueHouseName } from "./helpers/test-auth.ts";
import { seedReportMonth } from "./helpers/seed.ts";
import { SEED_FROM, SEED_TO } from "../../shared/src/testing/seed-month.ts";

// A browser far from the house: every bucket and label must still follow Europe/Berlin.
test.use({ timezoneId: "Asia/Tokyo" });

test("a seeded month reports, drills down to a DST day and exports", async ({ page }) => {
  await requireTestAuth(page);
  const session = await signInAsTestHouse(page, uniqueHouseName("reports"));
  await seedReportMonth(page, session.accessToken);

  await page.getByTestId("tab-reports").click();
  await page.goto(`/reports?range=month&from=${SEED_FROM}`);
  await expect(page.getByTestId("tile-feedings")).toHaveText(/154/);
  await expect(page.getByTestId("tile-longest-gap")).toHaveText(/18 h/);
  await expect(page.getByTestId("report-cat")).toBeVisible(); // two cats

  // month → week → day: the 23-hour day still lists its five feedings at Berlin wall times.
  await page.getByTestId("report-drill").getByRole("button", { name: /23 – 29 Mar/ }).click();
  await expect(page).toHaveURL(/range=week&from=2026-03-23/);
  await page.getByTestId("report-drill").getByRole("button", { name: /Sun 29 Mar/ }).click();
  await expect(page).toHaveURL(/range=day&from=2026-03-29/);
  const times = await page.getByTestId("day-feeding").locator("time").allTextContents();
  expect(times).toEqual(["07:00", "07:30", "13:00", "19:00", "20:00"]);

  // Back walks up the drill-down.
  await page.goBack();
  await expect(page).toHaveURL(/range=week&from=2026-03-23/);

  // The gap day: Luna's 20:00 is missing.
  await page.goto(`/reports?range=day&from=2026-03-15`);
  await expect(page.getByTestId("day-feeding")).toHaveCount(4);

  // CSV for the month: header + 154 rows, BOM stripped.
  await page.goto(`/reports?range=month&from=${SEED_FROM}`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("report-csv").click()]);
  expect(download.suggestedFilename()).toBe(`feedme2-${SEED_FROM}-${SEED_TO}.csv`);
  const text = (await (await download.createReadStream()).toArray()).map(String).join("").replace(/^﻿/, "");
  const lines = text.trimEnd().split("\r\n");
  expect(lines[0]).toBe("date,time,cat,amount,unit,grams,entered_value,entered_unit,source,note");
  expect(lines).toHaveLength(155);
});

test("a cat page shows its last 30 days and opens them in Reports", async ({ page }) => {
  await requireTestAuth(page);
  const session = await signInAsTestHouse(page, uniqueHouseName("trends"));
  await addCat(page, "Mochi");
  // First feeding of a cat without a default opens the sheet (house-flow.spec.ts does the same).
  await page.getByTestId("cat-feed").click();
  await page.getByTestId("feed-submit").click();
  await expect(page.getByTestId("feed-sheet")).toHaveCount(0);
  const auth = { headers: { authorization: `Bearer ${session.accessToken}` } };
  // The outbox syncs in the background; the report reads the server.
  await expect.poll(async () => ((await (await page.request.get("/api/feedings", auth)).json()) as { items: unknown[] }).items.length).toBe(1);
  const cats = ((await (await page.request.get("/api/cats", auth)).json()) as { cats: Array<{ id: string }> }).cats;

  await page.goto(`/cats/${cats[0]!.id}`);
  const trends = page.getByTestId("cat-trends");
  await expect(trends).toBeVisible();
  await expect(trends.getByText("No feedings in this range")).toHaveCount(0);
  const link = trends.getByTestId("cat-trends-link");
  await expect(link).toHaveAttribute("href", new RegExp(`range=custom.*cat=${cats[0]!.id}`));
  await link.click();
  await expect(page.getByTestId("tile-feedings")).toHaveText(/\b1\b/);
});
```
Add `import { addCat } from "./helpers/ui.ts";` at the top. The day list's times are in `<time>` elements (Task 7 `DayFeedings`).

- [ ] **Step 2: Run against the local stack** the way the CI job `webapp-e2e-full` does (`.github/workflows/deploy.yml`): in `backend/`, `cp .dev.vars.example .dev.vars` (if missing), `pnpm exec wrangler d1 migrations apply feedme2-db --local`, `pnpm exec wrangler dev --port 8787`; in `webapp/`, `pnpm dev --port 5192 --host 127.0.0.1`; then `E2E_BASE_URL=http://127.0.0.1:5192 E2E_REQUIRE_AUTH=1 pnpm --filter webapp exec playwright test --project=chromium e2e/reports.spec.ts`. Expected: both tests pass. Then run the whole suite the same way: everything green (the earlier 18 plus these 2).

- [ ] **Step 3: Commit**
```bash
git add webapp/e2e/reports.spec.ts webapp/e2e/helpers/seed.ts webapp/package.json
git commit -m "test(webapp): seeded-month e2e across a dst day from a browser in another zone, with csv

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(e2e files are under `webapp/`, so the hook bumps the webapp version.)

---

## Task 10: Docs, full verification, PR

**Files:**
- Modify: `handoff.md` (phase line → "Phase 4 Reports in review"; API rows for `GET /api/reports/summary` and `GET /api/reports/export.csv`; webapp route `/reports` and the cat-page trends; versions; log entry), `README.md` (Reports section: what it shows, the house-zone rule, Monday weeks, the 732-day cap), `CLAUDE.md` (Layout: `shared/src/zone.ts` is the only home for house-zone calendar math, `shared/src/reports.ts` for aggregation; `shared/src/testing/` is test-only and not exported)
- Create: `docs/handoffs/2026-10-12-phase4-execution-handoff.md` (per-task commits, review outcomes, decisions taken beyond the spec, known limitations, decisions pending for Andrey)

Decisions to record (taken by this plan; Andrey may overrule):
1. One `/api/reports/summary` (with `bucket`) replaces the spec's separate `summary`/`daily`/`weekly`/`monthly`/`heatmap` routes: one D1 read per screen.
2. CSV is a Worker route fetched with the bearer token and saved as a Blob (spec route kept; gigsy built CSV client-side because of the same header problem).
3. Weeks start on Monday; there is no house setting for it.
4. Cans use the house's **current** can size for the whole range.
5. Intervals are measured per cat inside the range; the gap before the first feeding of the range is not counted.
6. On a 25-hour day both 02:xx hours share one hour bucket.
7. No chart library; the palette is the cat's own colour per series and the accent token for single series (no `dataviz` skill exists in this setup, so these are the rules).
8. Reports are online-only; a cached report still shows offline.

- [ ] **Step 1: Docs** as listed.
- [ ] **Step 2: Full verification**
```bash
pnpm -r typecheck && pnpm -r test && python -m unittest discover -s scripts && BASE_REF=origin/main python scripts/check_version_bump.py
```
plus the local full-stack e2e from Task 9 Step 2. Paste the per-package test counts into the handoff.
- [ ] **Step 3: Push and PR** `feat/phase4-reports` → main, titled "Phase 4: reports", with the spec/plan links, the counts, the e2e result, the decisions above, and screenshots of `/reports` (light and dark, Pixel 7 width) attached through the PR description. CI runs the full-stack e2e on the PR.

---

## Self-review against the spec

- §1.3 Reports: per-day/week/month feedings (Task 2 `periods`, Task 5 bars, Task 7), amount totals in the house unit (Task 7 `formatTotal`), cans consumed (Task 2 `totals.cans`, Task 7 tile and unit toggle), mean interval and longest gap (Task 2, Task 7 tiles), time-of-day heatmap (Task 2, Task 5), drill-down month → week → day → feedings (Task 6 `drillTo`, Task 7 `DrillTable`/`DayFeedings`), CSV export (Tasks 3, 4, 7). House-wide and per-cat: cat filter (Tasks 4, 7) and the cat page (Task 8).
- §1.3 Cat page: per-cat charts (Task 8).
- §3.3 `/api/reports/*`: Task 4 (consolidation recorded as decision 1).
- §4.1 `/reports` with drill-down via the URL: Tasks 6, 7.
- §4.4: range picker day/week/month/custom, cat filter, unit toggle (house unit or cans), the four panels, the table with drill-down, the `FeedingChart` family (Task 5).
- §4.2 offline: reports online-only with an explicit message (Tasks 7, 8).
- §7 exit test: seeded-month e2e (Task 9) and snapshot tests for aggregations (Task 2).
- Global: house zone everywhere (Tasks 1, 2, 4, 6, 9), no `dark:` (Tasks 5, 7), no new dependency, version tiers, commit trailer.
- Review Focus 1–5 → Tasks 1/2, 1/4/6/9, 4/7, 2/5/7, 1/2/4.
- Types: `DateKey` and zone helpers (Task 1) are what Tasks 2, 3, 4, 6, 8 call; `ReportSummary`, `ReportBucket`, `aggregateReport`, `defaultBucket`, `MAX_REPORT_DAYS` (Task 2) are what Tasks 4, 6, 7 use; `seedMonth`/`randomSalt` (Task 2) are what Tasks 4, 7, 9 seed with; `csvCell`/`toCsv`/`feedingCsvRow`/`FEEDINGS_CSV_HEADERS` (Task 3) are what Task 4 uses; `BarChart`/`Heatmap`/`ACCENT` (Task 5) are what Tasks 7–8 render; `ReportFilters`/`drillTo`/`chartBucket`/`toSearchParams` (Task 6) are what Tasks 7–8 navigate with; `api.reportSummary`/`api.exportCsv`/`useReport`/`formatDuration`/`formatTotal` (Task 7) are what Task 8 reuses.
