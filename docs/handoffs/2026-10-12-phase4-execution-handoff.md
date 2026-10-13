# Phase 4 execution handoff — 2026-10-12

Branch `feat/phase4-reports` off `main` (after the Phase 2a/2b merges): the plan commit `bb6f689`, ten task commits from `827bc92` to `b682ddd`, eight fix commits around them (six per-task fix batches plus `a9f6adb` and `45c3044` after the whole-branch review) and this docs commit; not pushed, no PR yet. Plan: `docs/superpowers/plans/2026-10-12-phase4-reports.md` (Tasks 0–9 and Task 10 Step 1 ticked; Steps 2–3, full verification and the PR, are the dispatcher's). Spec: `docs/superpowers/specs/2026-09-20-feedme2-design.md` §1.3, §3.3, §4.1, §4.2, §4.4, §7 row "4 Reports". Live state: `handoff.md`.

## What was built

One line per plan task; the SHA is the feature commit, the fix commits after it.

| Task | What | Commits |
|---|---|---|
| 0 | CI: `workflow_dispatch` deploys only `main`; main runs are never cancelled (`cancel-in-progress` only for PRs); the push diff starts at the last green push/dispatch run (`lastgood` step), so a cancelled or failed run's changes reach the next one. Pinned by `scripts/test_workflow_guards.py` (3 tests). `handoff.md` brought up to the Phase 2 merge | `827bc92` |
| 1 | `shared/src/zone.ts`: date keys, `addDays`/`addMonths`/`startOfWeek` (Monday)/`startOfMonth`, `zonedParts`, `dateKeyOf`, DST-safe `midnightMs` and `dayBoundsMs`; `webapp/src/lib/day-boundary.ts` (the dashboard's "today") delegates to it | `eebe3b1`; per-UTC-day / quarter-hour offset cache and the skipped-midnight step `f1f64c8` |
| 2 | `shared/src/reports.ts`: `ReportSummarySchema`, `aggregateReport` (totals, per cat, periods stacked by cat, interval histogram, 7×24 heatmap), `defaultBucket`, `MAX_REPORT_DAYS` = 732; the seeded month `shared/src/testing/seed-month.ts` (March 2026, Europe/Berlin, 154 feedings, 5 240 g) and its snapshot | `4bb1e2e`; hour buckets capped at 7 days (`MAX_HOUR_BUCKET_DAYS`), one `zonedParts` per feeding, schema tightening `15ecd88` |
| 3 | `shared/src/csv.ts`: RFC 4180 `csvCell`/`toCsv` with the formula guard, `FEEDINGS_CSV_HEADERS`, `feedingCsvRow` in the house zone and unit | `daa61a2` |
| 4 | `GET /api/reports/summary` and `GET /api/reports/export.csv` (`backend/src/routes/reports.ts`); `FeedingsRepo.listForReport`/`listForExport`, `CatsRepo.listIncludingDeleted` | `ead3094`; `REPORT_MIN_DATE`/`REPORT_MAX_DATE` window (2000–2999), week keys from the zoned parts, canonical zone-cache keys capped at 64, summary `no-store` `316f088`; lowercase-only `cat` uuid `a9f6adb` |
| 5 | Hand-rolled SVG `BarChart` (stacked, drillable columns), `Heatmap`, `ChartFrame` (title plus an `sr-only` data table), token-layer colours | `564ffe9`; focus ring on every column, labels under their columns, NaN/negative guards, heatmap track for dark mode, `height` prop `6acd185` |
| 6 | `webapp/src/lib/report-filters.ts`: filters in the URL (`range`, `from`, `to`, `cat`, `unit`), presets, `shiftRange`, `chartBucket`, `drillLevel`, `drillTo`, `rangeTitle` | `355644e`; dates kept inside 2000–2999, bad cat ids dropped, explicit drill target `drillTo(f, key, level?)` `5d30ec2` |
| 7 | `/reports` screen: controls, tiles, four charts, drill table, day feedings, CSV download (a Blob through the bearer-token client); `useReport`; the Reports tab | `79eadae`; a stale `cat` in the URL is dropped (replace, not push), no "cans" toggle in a can house, the CSV object URL revoked late, dead code `a2861c5` |
| 8 | Cat page "Last 30 days" (`CatTrends`): amount per day in the cat's colour, feedings, mean interval, longest gap, "Open in Reports"; reports refetch after a drain that sent feedings and after a cat-page edit or delete (`drain-refresh.ts`) | `ed5d232`; report key carries the house zone, house and cat changes invalidate `["report"]`, a refused edit refreshes the lists only, day-boundary zone-validity cache `45c3044` |
| 9 | Exit test `webapp/e2e/reports.spec.ts` + `e2e/helpers/seed.ts`: the seeded month from a browser in Asia/Tokyo, drill to the DST day, CSV; and the cat page's trends into Reports | `b682ddd` |
| 10 | This handoff, `handoff.md`, README Reports section, CLAUDE.md layout rules, plan ticks and corrections | this commit |

## How it was verified

Every task ran its package's tests and typecheck; each was reviewed by a separate agent before its dependants started, and the must-fixes landed as the fix batches above.

- **Task reviews.** Task 0 ✅ (dispatcher). Task 1 ✅: a sweep of all 417 IANA zones over 2024–2030 agreed with Intl (historical repeated-midnight zones resolve to the later 00:00); the follow-up perf batch `f1f64c8` took 20 000 `dateKeyOf` calls from ~75 ms to ~4 ms warm. Tasks 2+3 ✅ with must-fixes (hour-bucket cap, one zone lookup per feeding, a missing-cat comment, schema tightening) → `15ecd88`. Task 4 ❌: `to=9999-12-31` made `dayBoundsMs` throw (a 500) → `316f088`. Task 5 → `6acd185` (WCAG 2.4.7 focus, label placement, NaN). Task 6 → `5d30ec2`. Task 7 → `a2861c5`. Task 8 ✅ with nits (handled in `45c3044`).
- **Whole-branch review** (after `b682ddd`): **mergeable, no must-fix**. Its should-fixes landed as `a9f6adb` (zod's `.uuid()` is case-insensitive, so an uppercase `cat` passed validation and missed the case-sensitive D1 key, a 404; the reports query now takes shared's lowercase `UuidSchema`, 400 otherwise) and `45c3044` (the report key includes the house zone; `usePatchHouse` and every cat create/rename/recolour/delete invalidate `["report"]`; a refused cat-page edit refreshes the lists only; the dashboard day boundary caches zone validity instead of building an `Intl.DateTimeFormat` per call).
- **Exit test** (spec §7: e2e over a seeded month, snapshot tests for aggregations): `reports.spec.ts` **2/2** against the local stack (wrangler dev + vite, `E2E_REQUIRE_AUTH=1`), browser in **Asia/Tokyo**, house in **Europe/Berlin**, across the **2026-03-29** spring-forward day (5 feedings at 07:00, 07:30, 13:00, 19:00, 20:00 Berlin time; 154 in the month; Luna's longest gap 18 h; the CSV has 154 rows plus the header). Full local e2e: **20 passed, 0 skipped**. The aggregation is pinned by the seeded-month snapshot in `shared/src/__snapshots__/reports.test.ts.snap`.
- **Unit counts** (re-run for this docs commit): shared **110**, backend **224**, webapp **459**, scripts **45** (at the whole-branch review: 109, 223, 449, 45).
- **CPU** (node, warm, 35 000 feedings over 732 days): summary ~11–35 ms, CSV ~40–50 ms; a realistic house (two cats, a few feedings a day) 2–7 ms. See the known limitations.

Not run in this phase: CI on the branch (not pushed), the production e2e, and the full `pnpm -r typecheck && … check_version_bump.py` command of Task 10 Step 2.

## Decisions taken beyond the spec

From the plan (Task 10's list; Andrey may overrule):

1. **One `/api/reports/summary`** (with `bucket`) replaces the spec's separate `summary`/`daily`/`weekly`/`monthly`/`heatmap` routes: one D1 read per screen.
2. **CSV is a Worker route** fetched with the bearer token and saved as a Blob (the spec's route kept; a plain link cannot carry the `Authorization` header).
3. **Weeks start on Monday**; there is no house setting for it.
4. **Cans use the house's current can size** for the whole range.
5. **Intervals are per cat inside the range**; the gap before the range's first feeding is not counted.
6. **On a 25-hour day both 02:xx hours share one hour bucket.**
7. **No chart library**; series use each cat's own colour, a single series the accent token. Every chart has an `sr-only` table.
8. **Reports are online-only**; a cached report still shows offline ("Showing the last loaded report"), and with nothing cached the page says "Reports need a connection".

Taken during execution:

9. **One date window, 2000-01-01..2999-12-31** (`REPORT_MIN_DATE`/`REPORT_MAX_DATE` in `shared/src/reports.ts`), shared by the Worker (400 outside it, before any calendar math) and the webapp's URL parser (falls back to this week). feedme2 has no data before 2020; the window keeps every derived key a four-digit year.
10. **Hour buckets cover at most 7 days** (`MAX_HOUR_BUCKET_DAYS`); the UI asks for hours only on a one-day range. `defaultBucket`: 1 day → hour, ≤ 92 → day, ≤ 400 → week, else month.
11. **Per-UTC-day offset cache in `zone.ts`**: an offset that agrees at a UTC day's first and last second holds all day; a transition day falls back to quarter-hour buckets, and a bucket whose ends disagree reads Intl directly. Zones are keyed by Intl's canonical name and capped at 64 zones and 64 spellings.
12. **Report queries live under `["report"]`** (the key carries the house zone, range, cat and bucket; the day's feeding list is `["report", "day-feedings", …]`), never under `["feedings"]`, which the dashboard rewrites as `Feeding[]`.
13. A pasted custom link longer than 732 days opens on its first 732 days rather than failing.

## Known limitations (Phase 4)

- **Worker CPU on very large ranges.** 35 000 feedings over two years cost ~11–35 ms (summary) and ~40–50 ms (CSV) in node; a realistic house is 2–7 ms. That is over the **Workers Free** plan's 10 ms CPU limit if the account is on Free, which is **unconfirmed** (decision pending 1).
- **CSV formula guard** prefixes cells starting `= + - @`, tab or CR; it misses a leading space before `=` and a full-width `＝`, which some spreadsheets still evaluate.
- **"Today" does not roll over at midnight** while Reports (or a cat page) stays open: the default week and the 30-day window are computed at render.
- **A day's feeding list shows the latest 200 feedings** of that day, with a note when there are more.
- `cans` is rounded with `Math.round(x * 100) / 100`, so a binary edge such as 1.005 rounds down.

## Decisions pending for Andrey

1. **Workers plan: Free or Paid?** Decides whether the CPU numbers above are a limit (Free: 10 ms) or a non-issue. On Free, the options are a shorter maximum range, a pre-aggregated daily table, or building the CSV in the client.
2. **Weeks start on Monday for every house?** No setting today (decision 3).
3. **Cans at the current can size?** A can-size change re-prices the whole history (decision 4); the alternative is the can size at the time of each feeding, which D1 does not store today.

## Plan corrections

Recorded in the plan under "Corrections recorded during execution":

- A 425-day custom range buckets by **month** (`defaultBucket` switches above 400 days); the plan's Task 6 test expected week.
- `POST /api/feedings` answers **201**; the seeding helpers assert it.
- `@testing-library/*` is **not installed** and no dependency was added: webapp component tests use `react-dom/client` + `act()` like `Sheet.test.tsx`.
- `drillTo(f, key, level?)` gained the explicit level. The plan's file list named `shared/test-fixtures/report-month.json`; the seed lives in `shared/src/testing/seed-month.ts` (fixed in the plan).

## Follow-ups (none blocking)

- `GET /api/feedings` still validates its `cat` filter with zod's case-insensitive `.uuid()` (`backend/src/routes/feedings.ts`): an uppercase id passes and matches nothing. Switch it to shared's `UuidSchema` as `a9f6adb` did for reports.
- A cat deleted elsewhere (another phone or tab) does not invalidate `["report"]` here; the report catches up on its 60 s staleTime.
- Charts have one tab stop per column, not one per chart with arrow keys inside; a long range is many tab stops.
- "Today" rollover at midnight while the page stays open (a timer, or re-derive on focus).
- CSV guard: also prefix a cell whose first non-space character is `=`, and the full-width `＝`.
- `CatPage`'s `onDrained` and its `refresh()` can both invalidate after one edit (pre-existing; a harmless double fetch).

## CI-only failures fixed on the PR

The local full stack passed 20/20, but PR #4's `Webapp E2E (full stack)` job on the Linux runner failed twice. A new CI step prints Playwright's `error-context.md` page snapshots into the job log, so a CI-only failure can be read without downloading the report.

1. **The Reports page was wider than a phone** (`aa9b76e`). Each chart's screen-reader data table had `sr-only` on the `<table>` itself. A table sizes to its content and ignores `width: 1px`, so `/reports` was 472 px wide on a 412 px screen. Mobile Chrome zoomed out, and on Linux the e2e's taps landed on the heatmap or on the next drill row. The table now sits inside an `sr-only` div. A new e2e helper, `expectNoHorizontalOverflow`, fails any page wider than the screen. Real phones would have seen a sideways-scrolling Reports page.
2. **A restored cache showed "No devices paired yet"** (`6ec5eae`). The device-flow spec pairs a device and later does a full reload. The throttled cache save (250 ms) could lose the race with the reload. The restored device list then looked fresh to its 15 s `staleTime`, so it never refetched. Phase 1 had fixed the same race for cats and feedings only. Now `refreshAfterHydration` marks every restored query stale. Phase 4's larger persisted cache, with reports and trends, made the race likelier on the slower runner.

## Process notes

- Several agents shared one checkout: pathspec-only staging under the commit lock (`mkdir .git/feedme2-commit.lock`), never `git add -A`.
- The hook bumped the tiers each staged diff touched: webapp 0.1.39 → **0.1.55**, worker 0.1.39 → **0.1.47**; no migration (schema stays `0002_devices_pairings`); firmware untouched at 0.1.36 (firmware is paused). `.github/`, `scripts/` and docs bump nothing.

## Next steps

1. Task 10 Step 2: `pnpm -r typecheck && pnpm -r test && python -m unittest discover -s scripts && BASE_REF=origin/main python scripts/check_version_bump.py`, plus the local full-stack e2e.
2. Push and open **"Phase 4: reports"** (spec/plan links, the counts, the e2e result, the decisions above, `/reports` screenshots light and dark at Pixel 7 width). CI runs the full-stack e2e on the PR.
3. Andrey: the Workers plan question before merge; then merge, watch the deploy (the first `main` run under the new CI guards) and run the production e2e.
