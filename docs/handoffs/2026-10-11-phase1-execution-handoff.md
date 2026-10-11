# Phase 1 execution handoff — 2026-10-11

Branch `feat/phase1-core` (31 commits ahead of `origin/main`, not pushed, no PR yet). Plan: `docs/superpowers/plans/2026-10-11-phase1-core.md` (Tasks 1–18 ticked except Task 18 Step 3, push and PR). Spec: `docs/superpowers/specs/2026-09-20-feedme2-design.md`. Live state: `handoff.md`. Supersedes `2026-09-20-phase0-execution-handoff.md`.

## What was built

One line per plan task; the SHA is the feature commit, with the follow-up fix commits after it.

| Task | What | Commits |
|---|---|---|
| plan | Phase 1 implementation plan | `25bc4b7` |
| 1 | Migration `0001` (houses, cats, feedings, refresh tokens, `log_entries` additions), Drizzle schema, test helper | `a376e8e`; fix `7557cdd` (tenancy FK, positive checks, cursor and log indexes) |
| 2 | Shared API contracts (house, cats, feedings, auth, logs) | `393f3c9`; fix `11ad77b` (contracts, amount parsing/formatting, hunger edges) |
| 3 | Units module pinned by `fixtures/unit-vectors.json` | `3ddacc7` |
| 4 | Hunger module pinned by `fixtures/hunger-vectors.json` | `e25c7a7` |
| 5 | PIN hashing (PBKDF2), access/refresh tokens, `requireHouse` middleware | `44f6cfc` |
| 6 | Auth routes: setup, login, refresh, logout, me, pin, test-login | `0e2f711`; fixes `3601881`, `265c96f` (refresh grace chain link) |
| 7 | House settings GET/PATCH | `60c5487` |
| 8 | Cats CRUD, house-scoped, idempotent create | `b3c17b1`; fix `c45263d` (atomic cap and last-cat delete, 410 on deleted id) |
| 9 | Feedings CRUD with compound-cursor paging and denormalised cat defaults | `786e1e9`; fix `265c96f` |
| 10 | Persisted request logs, log upload, house-scoped debug feed, hourly housekeeping cron | `3dd2285`; fixes `0b3af21`, `b293479` |
| 11 | Web auth store, API client with refresh, AuthGate, Setup and Login | `ff3eb64`; fix `929064e` |
| 12 | Cat silhouettes from the feedme masters, CatFigure, HungerRing, pose mapping | `c45b4f8` |
| 13 | Dashboard with hunger state, feed sheet, today's totals | `4b4e076`; fix `4fe341e` |
| 14 | Offline outbox, ordered sync engine, persisted query cache | `a7a5606`; fixes `97f7f47`, `fb2fdb8` |
| 15 | Settings screen and cat history with edits | `14634ec`; fix `db1f847` |
| 16 | Log upload sink and the merged, filterable console feed | `497e833`; fix `a35e776` |
| 17 | End-to-end flow, offline sync spec, test-auth gate in CI | `571396a` |
| 18 | Docs, full verification (this handoff) | the commit that added this file |

## How it was verified

Run from the repo root on the branch tip (before the docs commit) on 2026-10-11:

```
pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm -r test && python -m unittest discover -s scripts && (cd firmware && pio test -e native) && BASE_REF=origin/main python scripts/check_version_bump.py
```

- typecheck: shared, backend, webapp all clean. The whole-branch reviewer independently got the same counts on the final tree (shared 57, backend 153 in 13 files, webapp 368 in 32 files, scripts 42, version check green).
- shared: 8 files, **57** tests passed. backend: 13 files, **153** passed. webapp: 32 files, **368** passed.
- scripts (version tooling): **42** tests OK. firmware native: **8** test cases succeeded.
- `check_version_bump.py`: "All touched tiers bumped their version."
- Playwright was **not** run in this pass. The e2e specs (`webapp/e2e/`: smoke, hidden-console, house-flow incl. offline sync) run in CI, and locally with `E2E_BASE_URL=http://127.0.0.1:5173 E2E_REQUIRE_AUTH=1 pnpm test:e2e` against wrangler dev (8787) and vite (5173).

## Deviations from the plan worth knowing

- **Compound feedings cursor** `fedAt:id` (string, `encodeFeedingsCursor`/`decodeFeedingsCursor` in `shared/src/api.ts`), ordered `fedAt desc, id desc`. `nextCursor` is `string | null`. The plan's numeric cursor drops rows that share a timestamp.
- **`LoginBody` is lenient** (its own schema): login accepts any non-empty name and PIN (format rules apply only at setup and PIN change), so houses created under older rules can still sign in; a bad PIN is the uniform 401.
- **`levelColor("hungry")` = warn** (spec: orange); only `very_hungry` and `starving` are danger.
- **Refresh grace window 60 s.** A refresh token replayed within 60 s of being consumed is treated as a lost response or a second tab: a new child token is issued, nothing is revoked. Older replays revoke the whole chain. Tombstones are kept (expiry = consumed + 24 h). Trade-off: a stolen token has a 60 s window.
- **`/api/auth/test-login` exists only where `ENVIRONMENT` is `development` or `test`** (fail closed: unset or production gives 404), and refuses a house that already has a PIN.
- **Feedings are accepted for soft-deleted cats** of the same house (an offline outbox may flush after a cat is deleted); a cat of another house gives 404 `cat_not_found`.
- **`fedAt` must be ≤ now + 5 min**, else 400 `fedat_in_future` (POST and PATCH); `fedAt` ≥ 1.
- **DELETE is idempotent**: an already-deleted own cat or feeding answers 204. The sync engine treats 404 on delete and 410 on create as terminal.
- **Cats cap (8) and "never delete the last cat" are atomic** single statements (cap and next `sort_order` in one insert; last-cat delete guarded in the `WHERE`). Re-POST of a soft-deleted cat id gives 410 `cat_deleted`; same id with a different body, first write wins.
- **A duplicate feeding id owned by another house gives 409 `id_conflict`**, nothing written.
- **Login names are NFKC-normalised** (`name_key`), and login always spends one PBKDF2 verify (dummy salt) so unknown names and pinless houses cost the same as a wrong PIN.
- **Anonymous requests persist only warn and above** (no D1 writes bought by scanners); an anonymous 4xx is logged at info. `x-client-id` is validated (`^[\w-]{1,64}$`), else ignored. Log rows are bounded to 1 KB of `data`, ts is clamped, an over-limit body gets 413 `payload_too_large`, and the final request line and an unhandled-error stack are exempt from the per-request log cap.
- **Persisted query cache is saved on page hide and refetched after hydration** (cache isolated per house; purged on sign-out).
- **Validation errors** are `{error:"invalid_request", issues:[{path,message}]}` (400) everywhere via one validator hook.

## Decisions pending for Andrey

1. **Future `fedAt`: reject or clamp?** `fedat_in_future` rejects `fedAt` beyond now + 5 min (`backend/src/routes/feedings.ts`, about lines 32 to 60); the webapp also guards client-side. A phone clock more than 5 minutes ahead gets its feedings dropped with only a count banner. The alternative is clamping to now.
2. **"A house keeps at least one cat" is not in the spec.** Signup starts with zero cats; once one exists the last cannot be deleted (409). Keep, drop, or put it in the spec?
3. **No login rate limiting.** A 4 to 12 digit PIN (often 4) is brute-forceable by a patient attacker (uniform cost helps timing only). Needs a spec-level decision (per-house attempt counter in D1, or Cloudflare rate limiting); not in the Phase 1 plan.
4. **"1,000" parses as 1.0** (a comma is a decimal separator). Accepted; revisit if users type thousands separators.
5. **Stepper rounding drift accepted.** Quarter-can steps round at each tap, so four taps give 155924 mg, not 155922. If fixed, make `stepMg`/`snapToStep` index-based in `shared`, `Units.h` and the fixtures together.
6. **Dead outbox rows are never revived or purged.** After 10 failed attempts a row is parked and surfaced as a sync problem; nothing retries or clears it automatically. Decide whether Settings gets "retry/discard".
7. **Console fans out one `/api/debug/logs` request per level** until the endpoint grows a `minLevel` param (cheap backend change; Phase 2 or cleanup).

## Security and accepted risks (whole-branch review)

Verdict of the whole-branch review: mergeable, no code must-fixes. Accepted for Phase 1:
- **No rate limiting anywhere.** Login brute force is slowed only by PBKDF2; `/auth/setup` is unlimited; request body size is capped only on `/api/logs`. Suggested follow-up: a Workers rate-limit binding on `/auth/login` and `/auth/setup`, plus a global `bodyLimit` of about 256 KB.
- **Access tokens stay valid up to 15 minutes** after logout or PIN change (by design: stateless JWT; refresh tokens are revoked immediately).
- **drizzle-orm is on `^0.36.0`** (a caret on 0.x stays within 0.36.x). Keep it there or add a comment before upgrading: 0.44+ embeds bound parameters (pin hashes, tokens) in error messages, and the `unhandled` log row would capture them.

## Deploy watch items

- **PBKDF2 CPU time.** 100k iterations on setup, login and PIN change may exceed the Workers Free-plan 10 ms CPU limit. Check the first production login (and setup) right after the merge deploy; if it fails with a CPU-limit error, the options are a lower iteration count (`ITERATIONS` in `backend/src/auth/pin.ts` is one constant and hashes do not record it, so changing it needs a stored-format change or a migration of existing hashes) or a paid plan.
- **`AUTH_SECRET`** was set in production during Phase 0 provisioning; the worker refuses to sign with fewer than 32 characters, so confirm the first `POST /api/auth/setup` succeeds.

## Known follow-ups (nits, none blocking)

Webapp
- **Bug to fix next:** Settings sign-out reads the refresh token before `api.logout`. If `apiFetch` rotates the token first, the server revokes the OLD row and the new child stays valid 30 days server-side (the client discards it). Fix: build the body at send time, or revoke the children of the presented token.
- PATCH 404 on a feeding deleted elsewhere should count as sent in the sync engine (as DELETE 404 already does).
- House rename 409 shows the generic message instead of "name taken".
- Bare `crypto.randomUUID()` in CatEditor, FeedSheet and Dashboard throws on plain-http LAN dev; share one `newId()` with the client-id fallback.
- Sync: banner count of unsynced/dropped feedings is React state only (lost on reload); a poison 5xx at the head of the queue blocks about 33 minutes before parking; cross-tab coalesce into an in-flight row is unguarded (narrow).
- Sheet and console share one `inert` counter; Sheet should restore the body overflow class only if it added it.
- `FeedSheet` edit mode should not touch `fedAt` unless the time changed (CatPage already does this).
- Settings preset pick: on PATCH failure, resync the grams draft from house data. `CatPage.settle()`: `void settle()` needs a catch.
- Settings and CatPage still carry their own chrome; fold them under `AppShell`.
- `LogList` `sameEntry` compares `data` by reference; the `import.meta.hot` cast is probably dead; `seed()` does not flush; the upload timeout excludes token refresh.
- Sink: `pageshow(persisted)` should re-arm; keepalive flush should be one chunk of at most ~60 KB (chunk the hidden flush to ~20 entries).
- Response envelope schemas for house/cats/feedings were not added to `shared`; routes and the client define them locally.

Backend
- Malformed JSON gives a text/plain 400; it could be JSON like every other error.
- Rate limiting and a global body limit (see Security and accepted risks).
- `GET /api/debug/logs` `minLevel` param (see decision 7).
- Error strings: `not found`, `name taken`, `id conflict`, `a house keeps at least one cat` are phrases, the rest are snake_case codes. Normalise (and update the webapp, which matches on some of them) when next touched.
- Auth cleanup: `PATCH /pin` on a pinless (test-login) house should allow setting a PIN without `currentPin` (dev only); test-login on a soft-deleted house name should map the unique violation to 409; document the stolen-token trade-off next to `GRACE_MS`.
- Tests still wanted: cron failure path; logs 400 body shape; limit truncation.

Shared
- Nothing blocking. `canParts`/`GLYPH_TOLERANCE` are exported for the webapp; the firmware port (Phase 3) must match `fixtures/` rather than re-derive the rules.

## Process notes

- Two commit trailers differ from the rest: `3dd2285` (Task 10) says `Claude Sonnet 5.5` (a subagent followed its own session reminder); every other commit on the branch says `Claude Fable 5.1`. History was not rewritten. This docs commit also carries the Fable 5.1 line, as the plan specifies.
- When several agents share one checkout: pathspec-only staging, the commit lock protocol (`mkdir .git/feedme2-commit.lock`), never `git add -A`.

## Next steps

1. Push `feat/phase1-core` and open the PR **"Phase 1: core data + web"** (body in plan Task 18 Step 3). Do not push before Andrey has seen the decisions above, or accept that they are follow-ups.
2. Watch CI: version-check, shared/backend/webapp tests, preview deploy + smoke, **full-stack e2e including the test-auth gate** (it fails if `test-login` is unavailable, by design), firmware build (fixtures changed, so the firmware tier is exercised).
3. Merge to `main`: the deploy applies `0001` to remote D1 and ships the worker and the webapp. Check the migration step in the run before trusting the rest.
4. Verify production: `GET https://feedme2-api.atsyg-feedme.workers.dev/api/version` shows the new worker and schema; `pnpm test:e2e` against production (default `E2E_BASE_URL`): smoke and console pass, the flow specs skip because production has no test-login.
5. Still open from Phase 0: the deep-sleep bench spike (spec Q2, `docs/spikes/2026-09-deep-sleep-touch-wake.md`) and setting `WOKWI_CLI_TOKEN` so the Wokwi step runs.
6. Then Phase 2 per the spec's phase table (devices and pairing); the `minLevel` param and the pinless-PIN cleanup fit there.
