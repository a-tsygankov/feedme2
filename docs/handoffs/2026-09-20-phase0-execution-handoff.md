# Handoff: Phase 0 execution state (2026-09-20)

For the next agent (or Andrey) picking up feedme2. Read this, then `handoff.md`, then the plan.

## Where things are

- Merged into `main` (fast-forward, 2026-09-20). The repo is local only, not pushed; no remote exists yet. `feat/phase0-foundation` still points at the same commit.
- Plan: `docs/superpowers/plans/2026-09-20-phase0-foundation.md`. Spec: `docs/superpowers/specs/2026-09-20-feedme2-design.md`.
- Tasks 1–16, 18 and 19 are implemented, spec-reviewed, quality-reviewed and fixed. Task 17 (repo, provisioning, secrets, first deploy) and Task 20 (PR, CI) are **not done**: they need Andrey's credentials.
- Local verification is green: `pnpm -r typecheck`, `pnpm -r test` (shared 17, backend 10, webapp 53), `python -m unittest discover -s scripts` (42), `pio test -e native` (8), `pio run -e crowpanel`, `pio run -e simulator`, `pio run -e spike-sleep`, Playwright 9/9 against a local stack.

## What Andrey must do by hand

Done on 2026-09-21: steps 1, 2, 3 and 6 (wrangler login, D1 `26f85bd9-ebb1-4bd3-9798-8cbd420481e3`, R2, Pages project, first deploy verified), the worker `AUTH_SECRET`, and the push of `main` to the existing GitHub repo `a-tsygankov/feedme2` (which Andrey created as PUBLIC). Remaining: GitHub Actions secrets (`CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, optional `WOKWI_CLI_TOKEN`) via `scripts/setup-secrets.local.ps1 -GitHub`, then a green CI run, then step 8 (bench spike). The first two CI runs failed only at `Backend deploy` for lack of those secrets.

1. **Re-authenticate wrangler** (the stored OAuth session expired and its refresh token is rejected):
   ```bash
   cd C:/Workspaces/feedme2/backend && pnpm exec wrangler login && pnpm exec wrangler whoami
   ```
   Expect the account whose workers.dev subdomain is `atsyg-feedme`.
2. **Provision D1 and R2**, then paste the D1 id:
   ```bash
   cd C:/Workspaces/feedme2/backend && pnpm exec wrangler d1 create feedme2-db && pnpm exec wrangler r2 bucket create feedme2-firmware
   ```
   Replace `database_id = "PASTE-THE-UUID-FROM-STEP-3"` in `backend/wrangler.toml` with the printed UUID and remove the placeholder comment line above it. Commit as `chore(backend): real D1 database id`.
3. **Create the Pages project** (the PR preview deploy needs it):
   ```bash
   cd C:/Workspaces/feedme2/backend && pnpm exec wrangler pages project create feedme2-webapp --production-branch=main
   ```
4. **Create the private GitHub repo and push**:
   ```bash
   cd C:/Workspaces/feedme2 && gh repo create a-tsygankov/feedme2 --private --source=. --remote=origin --push && git push -u origin feat/phase0-foundation
   ```
5. **Secrets**: `cp scripts/setup-secrets.ps1 scripts/setup-secrets.local.ps1`, fill `CLOUDFLARE_API_KEY` and `CLOUDFLARE_ACCOUNT_ID` with the same values gigsy uses (they are in `C:/Workspaces/gigsy/scripts/setup-secrets.local.ps1`), optionally `WOKWI_CLI_TOKEN`, then `pwsh -File scripts/setup-secrets.local.ps1 -All`. Never paste values into chat or commits.
6. **First deploy** from the workstation so the preview e2e has a production worker to proxy to: `pwsh -File scripts/deploy.ps1 -All`, then verify:
   ```bash
   curl -s https://feedme2-api.atsyg-feedme.workers.dev/api/version
   curl -s https://feedme2-webapp.pages.dev/version.json
   ```
7. Phase 0 is already on `main`, so Task 20 becomes: push `main`, confirm the deploy workflow runs green, then update `handoff.md` to "Phase 0 complete". Future phases go through PRs.
8. **Bench spike** when the CrowPanel is on USB: follow `docs/spikes/2026-09-deep-sleep-touch-wake.md` and fill in the table. This answers spec Q2 and decides Phase 3's sleep design.

## Known loose ends (all deliberate, none blocking)

- **Commit trailers**: most commits on the branch carry `Co-Authored-By: Claude Sonnet 5` because the implementing subagents used their own attribution. Rewriting them (`git filter-branch --msg-filter`) was blocked by the session's destructive-git guard. Cosmetic; rewrite before pushing if you care, otherwise leave.
- **Firmware version bumps**: the pre-commit hook bumped the firmware tier on every firmware commit, so `kFirmwareVersion` is `0.1.4` while the tier is still a skeleton. Fine for now.
- `/api/debug/logs` is unauthenticated on purpose (`TODO(phase1)` in `backend/src/routes/debug.ts`); Phase 1 adds `requireHouse()`.
- The worker logs only to the in-memory ring buffer; the D1 sink into `log_entries` is Phase 1.
- `backend/drizzle.config.ts` points at `src/db/schema.ts`, which does not exist yet; `0000_init.sql` was hand-written. When the schema file lands, reconcile drizzle-kit's journal against the existing migration before running `db:generate`.
- `backend/test/helpers/migrate.ts` `splitStatements` splits on every `;` and strips only whole-line `--` comments. Fine for `0000_init.sql`; harden before a migration contains `;` in a string or a trailing comment.
- `compatibility_date = "2025-01-01"` is newer than the installed workerd; vitest prints a fallback warning. Bump the pool-workers package or lower the date when convenient.
- `LogEntrySchema.data` has no size cap yet; the spec says 1 KB per entry at the boundary. Add it with the upload sink in Phase 1.
- The spike uses ext0 wake (keeps RTC_PERIPH powered). If the idle budget is tight, try ext1 in Phase 3.
- `.npmrc` has `min-release-age=7` per Andrey's global rule, but pnpm 9 ignores it; the real cooldown key is `minimum-release-age` and needs pnpm 10.16+. Decide whether to bump pnpm or keep it as a marker.

## Gotchas learned this session

- **Parallel writers on one working tree**: running two implementer agents at once works only if each stages by explicit pathspec. `git add <dir>` and `git add --renormalize .` swept in the other agent's files twice. The pre-commit hook also races when two commits touch `webapp/package.json` within seconds (left an `MM` index state once; `git reset -q webapp/package.json` cleared it).
- `core.filemode=false` on this Windows checkout: `git update-index --chmod=+x` must be run before commit, or the mode is lost.
- `wokwi-cli` is not installed locally; the scenario only runs in CI (`WOKWI_CLI_TOKEN`).
- PlatformIO's native env uses the host MinGW GCC 15.2 from WinGet; no PlatformIO toolchain download is needed.
- Vite HMR full-page reloads (triggered by other agents editing `src/`) made Playwright fail once with "Execution context was destroyed"; rerun after edits settle.
- D1's `exec()` treats each newline as a statement boundary; use `prepare().run()` for multi-line SQL.
- Hono 4 catches route errors inside `compose()` and sets `c.error`; a try/catch around `next()` in middleware never sees them.

## Layout reminder

```
shared/    @feedme2/shared: RingBuffer, compareVersions, Logger core, zod schemas (LogEntry, VersionResponse, DebugLogsResponse)
backend/   Hono worker: /api/health, /api/version, /api/debug/logs; migrations/0000_init.sql (log_entries)
webapp/    React/Vite PWA: Shell, hidden console (3 taps on the wordmark), UpdateBar, sw.ts, /version.json poll; e2e/ (9 specs)
firmware/  PlatformIO: crowpanel / simulator / native / spike-sleep; main.cpp boot screen + serial input channel; wokwi/boot.scenario.yaml
scripts/   version_rules/bump/check (+tests), deploy.sh/.ps1, setup-secrets.ps1
.github/   deploy.yml (11 jobs), version-check.yml
```

## Next phase

Phase 1 (core data + web) per the spec's phase table: house auth, cats, feedings, units module, dashboard, settings, offline outbox, unified logging with the D1 sink and the console's device tab. Write its plan with the `writing-plans` skill from the spec before starting.
