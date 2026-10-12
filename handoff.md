# feedme2 — state of the world

Single page. Update at the end of any session that changes phase, adds a resource, or resolves a spec open question.

## Phase
Phase 1 (core data + web) **merged and deployed** (PR a-tsygankov/feedme2#1 merged 2026-10-11; production worker 0.1.25, schema `0001_houses_cats_feedings.sql`, webapp 0.1.30; production e2e 12 passed / 5 skipped). Phase 2 is split into two plans: **2a device API + simulator** (`docs/superpowers/plans/2026-10-11-phase2a-device-api.md`) is **in review** on `feat/phase2a-device-api` (implemented, whole-branch reviewed, PR "Phase 2a: device API + simulator" pending; handoff `docs/handoffs/2026-10-11-phase2a-execution-handoff.md`), and **2b firmware MVP** (`docs/superpowers/plans/2026-10-11-phase2b-firmware-mvp.md`) is next and already follows the 2a contract. Open items: the deep-sleep bench spike (`docs/spikes/2026-09-deep-sleep-touch-wake.md`, Phase 3), `WOKWI_CLI_TOKEN`, the Phase 1 decisions pending for Andrey (see the Phase 1 handoff) and the three Phase 2a ones (Phase 2a handoff).

## Live resources (provisioned and first-deployed 2026-09-21)
| Thing | Name / URL | Notes |
|---|---|---|
| Worker | `feedme2-api` → https://feedme2-api.atsyg-feedme.workers.dev | deployed by `.github/workflows/deploy.yml` on push to main |
| Pages | `feedme2-webapp` → https://feedme2-webapp.pages.dev | per-branch previews `<branch>.feedme2-webapp.pages.dev` |
| D1 | `feedme2-db` (`26f85bd9-ebb1-4bd3-9798-8cbd420481e3`) | migrations via `wrangler d1 migrations apply`; `0001` is applied remotely; `0002_devices_pairings.sql` is on the Phase 2a branch and is applied remotely by the first main deploy after merge |
| R2 | `feedme2-firmware` | OTA binaries (Phase 3) |
| GitHub secrets | `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `WOKWI_CLI_TOKEN` | set with `scripts/setup-secrets.local.ps1 -GitHub` |
| Worker secrets | `AUTH_SECRET` | set in production during Phase 0 provisioning (2026-09-21) with `scripts/setup-secrets.local.ps1 -Cloudflare`; Phase 1 signs every token with it (must be at least 32 characters). Phase 2a also signs the 365-day device tokens with it: **rotating `AUTH_SECRET` unpairs every device** |

## API routes
All under `/api`. Live in production since 2026-10-11: everything except the Phase 2a rows (marked below), which ship with the Phase 2a merge. Everything except `health`, `version`, `auth/setup|login|refresh|test-login` and `pair/start|check` needs `Authorization: Bearer <token>`: a house access token (data scoped to its house) for the web routes and `pair/confirm`, a **device token** for `device/*` (house and device come from the verified token, never from the body).
| Route | Notes |
|---|---|
| `GET health`, `GET version` | public (Phase 0) |
| `POST auth/setup`, `login`, `refresh`, `logout`; `GET auth/me`; `PATCH auth/pin` | house name + PIN; 15-min access JWT, 30-day rotating refresh token (60 s replay grace) |
| `POST auth/test-login` | no PIN; only where `ENVIRONMENT` is `development` or `test`, else 404 (used by e2e and CI) |
| `GET`, `PATCH house` | nine settings: food unit, can size, step sizes, default hungry-after, device sleep and sync intervals, timezone |
| `GET`, `POST cats`; `PATCH`, `DELETE cats/:id` | max 8 cats, never zero after the first; soft delete |
| `GET`, `POST feedings`; `PATCH`, `DELETE feedings/:id` | list is paged by compound cursor `fedAt:id` (`cat`, `from`, `to`, `limit`); POST is an idempotent batch (≤ 100) |
| `POST logs` | client log upload (house-scoped; anonymous callers persist nothing) |
| `GET debug/logs` | merged feed for the console; filters `source`, `level`, `minLevel` (rank, Phase 2a), `device`, `since`, `limit` |
| `POST pair/start`, `POST pair/check` (Phase 2a) | public. The device sends a self-chosen `pollSecret` (32 hex); `check` serves the token only to the holder of that secret, once, plus a 60 s redelivery; then `expired`. A new `start` for the same device id replaces its pending row |
| `POST pair/confirm` (Phase 2a) | house token. 404 `pair_code_unknown`, 409 `pair_code_used` / `device_in_use`, 429 `too_many_attempts` (+ `Retry-After`) after 10 failures per 10 min per house |
| `GET devices`, `PATCH devices/:id`, `DELETE devices/:id` (Phase 2a) | house token; DELETE = forget (revoke, 204) |
| `GET device/state` (Phase 2a) | device token; one read for cats, settings and the house; `ETag`/304 (the tag covers `tzOffsetMin`, so a DST change refreshes it) |
| `POST device/feedings` (Phase 2a) | device token; idempotent batch ≤ 100; `fedAt` is clamped to now when more than 5 min ahead or before 2020 (`clamped` lists those ids; 0 is allowed before the first clock sync); 409 `id_conflict` |
| `POST device/heartbeat`, `POST device/logs` (Phase 2a) | device token; heartbeat answers `{now}`; body caps 4 KB (heartbeat), 64 KB (feedings), 128 KB (logs) |
| cron `0 * * * *` | hourly housekeeping: log retention (7 d, 5 000 rows per house), expired refresh tokens, and (Phase 2a) expired `pending_pairings` |

## Webapp routes
`/login`, `/setup`; behind the auth gate: `/` (dashboard), `/cats/:id` (cat history), `/settings`; anything else redirects to `/`. Hidden console: triple-tap the logo. Phase 2a adds the Devices section in `/settings` and the deep link `/settings?pair=<code>#devices` (survives login; the section scrolls into view and pre-fills the code).

## Versions on the branch tip
webapp 0.1.38 · worker 0.1.38 · schema `0002_devices_pairings` · firmware 0.1.8 (production still runs webapp 0.1.30, worker 0.1.25, schema 0001 and the Phase 0 firmware value until the Phase 2a merge deploys).

## Open questions (spec §0)
Q1 battery pin · Q2 touch-controller rail (spike: `docs/spikes/2026-09-deep-sleep-touch-wake.md`) · Q3 shipped with five avatar poses (A1, A4, B1, C1, C2), the two new poses still unmade · Q4 shipped as a per-install opaque `x-client-id` · Q5 shipped as `CAN_PRESETS` plus custom grams.

## Simulator
`pnpm --filter @feedme2/device-sim start pair|status|state|feed|log|sync|heartbeat|forget-local` (see `tools/device-sim/README.md`). State lives in `./device-sim.json` (gitignored); exit 2 means a transient sync stop, queues kept.

## Known limitations (Phase 2a)
`/pair/start` is public and replaces the pending row for that device id (a nuisance, not a takeover: the poll secret protects the token). The confirm budget is read-then-record, so parallel guesses can exceed 10, and it is per house while `/auth/setup` is unlimited (anyone can mint houses). No per-device log rate limit. Devices clamp `fedAt`, the web rejects it. Details and follow-ups: the Phase 2a handoff.

## Known limitations (Phase 1)
No rate limiting anywhere (login is slowed only by PBKDF2; `/auth/setup` unlimited; body size capped only on `/api/logs`). Access tokens stay valid up to 15 min after logout or PIN change. Feedings with `fedAt` more than 5 min ahead are rejected (a fast phone clock loses them). Deploy watch item: PBKDF2 at 100k iterations may exceed the Workers Free-plan CPU limit; check the first production login. Details and follow-ups: the Phase 1 execution handoff.

## Log
- 2026-10-11 — Phase 2a (device API + simulator) implemented, reviewed (mergeable) and fixed on `feat/phase2a-device-api`; local e2e 18/18 and the simulator CLI drove a real pairing. Push and PR are next; the 2b plan was updated to the poll-secret contract.
- 2026-10-11 — Phase 1 merged (PR #1) and deployed; production e2e 12 passed / 5 skipped. Phase 2a (device API + simulator) and 2b (firmware MVP) plans written.
- 2026-10-11 — Whole-branch review: mergeable, no code must-fixes; limitations above recorded in the handoff.
- 2026-10-11 — Phase 1 tasks 1–17 implemented, reviewed and fixed on `feat/phase1-core`; Task 18 docs and full verification green (shared 57, backend 153, webapp 368, scripts 42, firmware native 8). Push, PR and the decisions pending for Andrey are next.
- 2026-09-21 — CI secrets set; `workflow_dispatch` run green (shared, backend, webapp, firmware); Phase 0 complete. WOKWI_CLI_TOKEN not set, so the Wokwi step skips.
- 2026-09-20 — spec approved; Phase 0 started.
- 2026-09-20 — Phase 0 tasks 1–16, 18, 19 implemented and reviewed; merged to main.
- 2026-09-21 — D1, R2 and the Pages project provisioned; first deploy from the workstation; /api/version live through the proxy; e2e 9/9 against production.
