# feedme2 — state of the world

Single page. Update at the end of any session that changes phase, adds a resource, or resolves a spec open question.

## Phase
Phase 1 (core data + web) **merged and deployed** (PR a-tsygankov/feedme2#1 merged 2026-10-11; production worker 0.1.25, schema `0001_houses_cats_feedings.sql`, webapp 0.1.30; production e2e 12 passed / 5 skipped). Phase 2 is split into two plans: **2a device API + simulator** (`docs/superpowers/plans/2026-10-11-phase2a-device-api.md`, in progress on `feat/phase2a-device-api`) and **2b firmware MVP** (`docs/superpowers/plans/2026-10-11-phase2b-firmware-mvp.md`, after 2a). Open items: the deep-sleep bench spike (`docs/spikes/2026-09-deep-sleep-touch-wake.md`, Phase 3), `WOKWI_CLI_TOKEN`, and the Phase 1 decisions pending for Andrey (see `docs/handoffs/2026-10-11-phase1-execution-handoff.md`).

## Live resources (provisioned and first-deployed 2026-09-21)
| Thing | Name / URL | Notes |
|---|---|---|
| Worker | `feedme2-api` → https://feedme2-api.atsyg-feedme.workers.dev | deployed by `.github/workflows/deploy.yml` on push to main |
| Pages | `feedme2-webapp` → https://feedme2-webapp.pages.dev | per-branch previews `<branch>.feedme2-webapp.pages.dev` |
| D1 | `feedme2-db` (`26f85bd9-ebb1-4bd3-9798-8cbd420481e3`) | migrations via `wrangler d1 migrations apply`; `0001` is on the branch, applied remotely by the first main deploy after merge |
| R2 | `feedme2-firmware` | OTA binaries (Phase 3) |
| GitHub secrets | `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `WOKWI_CLI_TOKEN` | set with `scripts/setup-secrets.local.ps1 -GitHub` |
| Worker secrets | `AUTH_SECRET` | set in production during Phase 0 provisioning (2026-09-21) with `scripts/setup-secrets.local.ps1 -Cloudflare`; Phase 1 signs every token with it (must be at least 32 characters) |

## API routes (live in production since 2026-10-11)
All under `/api`; everything except `health`, `version`, `auth/setup|login|refresh|test-login` needs `Authorization: Bearer <access token>`, and data is scoped to the token's house.
| Route | Notes |
|---|---|
| `GET health`, `GET version` | public (Phase 0) |
| `POST auth/setup`, `login`, `refresh`, `logout`; `GET auth/me`; `PATCH auth/pin` | house name + PIN; 15-min access JWT, 30-day rotating refresh token (60 s replay grace) |
| `POST auth/test-login` | no PIN; only where `ENVIRONMENT` is `development` or `test`, else 404 (used by e2e and CI) |
| `GET`, `PATCH house` | nine settings: food unit, can size, step sizes, default hungry-after, device sleep and sync intervals, timezone |
| `GET`, `POST cats`; `PATCH`, `DELETE cats/:id` | max 8 cats, never zero after the first; soft delete |
| `GET`, `POST feedings`; `PATCH`, `DELETE feedings/:id` | list is paged by compound cursor `fedAt:id` (`cat`, `from`, `to`, `limit`); POST is an idempotent batch (≤ 100) |
| `POST logs` | client log upload (house-scoped; anonymous callers persist nothing) |
| `GET debug/logs` | merged feed for the console; filters `source`, `level`, `device`, `since`, `limit` |
| cron `0 * * * *` | hourly housekeeping: log retention (7 d, 5 000 rows per house) and expired refresh tokens |

## Webapp routes
`/login`, `/setup`; behind the auth gate: `/` (dashboard), `/cats/:id` (cat history), `/settings`; anything else redirects to `/`. Hidden console: triple-tap the logo.

## Versions on the branch tip
webapp 0.1.30 · worker 0.1.25 · schema `0001_houses_cats_feedings` · firmware 0.1.7 (production still runs the Phase 0 values until the merge deploys).

## Open questions (spec §0)
Q1 battery pin · Q2 touch-controller rail (spike: `docs/spikes/2026-09-deep-sleep-touch-wake.md`) · Q3 shipped with five avatar poses (A1, A4, B1, C1, C2), the two new poses still unmade · Q4 shipped as a per-install opaque `x-client-id` · Q5 shipped as `CAN_PRESETS` plus custom grams.

## Known limitations (Phase 1)
No rate limiting anywhere (login is slowed only by PBKDF2; `/auth/setup` unlimited; body size capped only on `/api/logs`). Access tokens stay valid up to 15 min after logout or PIN change. Feedings with `fedAt` more than 5 min ahead are rejected (a fast phone clock loses them). Deploy watch item: PBKDF2 at 100k iterations may exceed the Workers Free-plan CPU limit; check the first production login. Details and follow-ups: the Phase 1 execution handoff.

## Log
- 2026-10-11 — Phase 1 merged (PR #1) and deployed; production e2e 12 passed / 5 skipped. Phase 2a (device API + simulator) and 2b (firmware MVP) plans written.
- 2026-10-11 — Whole-branch review: mergeable, no code must-fixes; limitations above recorded in the handoff.
- 2026-10-11 — Phase 1 tasks 1–17 implemented, reviewed and fixed on `feat/phase1-core`; Task 18 docs and full verification green (shared 57, backend 153, webapp 368, scripts 42, firmware native 8). Push, PR and the decisions pending for Andrey are next.
- 2026-09-21 — CI secrets set; `workflow_dispatch` run green (shared, backend, webapp, firmware); Phase 0 complete. WOKWI_CLI_TOKEN not set, so the Wokwi step skips.
- 2026-09-20 — spec approved; Phase 0 started.
- 2026-09-20 — Phase 0 tasks 1–16, 18, 19 implemented and reviewed; merged to main.
- 2026-09-21 — D1, R2 and the Pages project provisioned; first deploy from the workstation; /api/version live through the proxy; e2e 9/9 against production.
