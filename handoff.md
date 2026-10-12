# feedme2 — state of the world

Single page. Update at the end of any session that changes phase, adds a resource, or resolves a spec open question.

## Phase
Phase 1 (core data + web) merged and deployed 2026-10-11 (PR a-tsygankov/feedme2#1). **Phase 2a (device API + simulator, PR #2) and Phase 2b (firmware MVP, PR #3) merged and deployed 2026-10-12**: production serves worker 0.1.39 with schema `0002_devices_pairings.sql` (webapp 0.1.39); production e2e 12 passed / 6 skipped; all five Wokwi HIL-2 scenarios passed in CI. The #2 merge run was cancelled by the #3 merge run, so 2a deployed only after a manual `workflow_dispatch` on main; `deploy.yml` now never cancels main runs, diffs pushes from the last green run and deploys only main on dispatch (pinned by `scripts/test_workflow_guards.py`). **Firmware is paused**: Andrey may change the device, so Phase 3 (power + OTA) is on hold. **Phase 4 Reports in progress on `feat/phase4-reports`** (plan `docs/superpowers/plans/2026-10-12-phase4-reports.md`). Handoffs per phase in `docs/handoffs/`; open items: the deep-sleep bench spike (`docs/spikes/2026-09-deep-sleep-touch-wake.md`) and the decisions pending for Andrey in the Phase 1, 2a and 2b handoffs.

## Live resources (provisioned and first-deployed 2026-09-21)
| Thing | Name / URL | Notes |
|---|---|---|
| Worker | `feedme2-api` → https://feedme2-api.atsyg-feedme.workers.dev | deployed by `.github/workflows/deploy.yml` on push to main |
| Pages | `feedme2-webapp` → https://feedme2-webapp.pages.dev | per-branch previews `<branch>.feedme2-webapp.pages.dev` |
| D1 | `feedme2-db` (`26f85bd9-ebb1-4bd3-9798-8cbd420481e3`) | migrations via `wrangler d1 migrations apply`; `0001` and `0002_devices_pairings.sql` are applied remotely |
| R2 | `feedme2-firmware` | OTA binaries (Phase 3) |
| GitHub secrets | `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `WOKWI_CLI_TOKEN` | set with `scripts/setup-secrets.local.ps1 -GitHub` |
| Worker secrets | `AUTH_SECRET` | set in production during Phase 0 provisioning (2026-09-21) with `scripts/setup-secrets.local.ps1 -Cloudflare`; Phase 1 signs every token with it (must be at least 32 characters). Phase 2a also signs the 365-day device tokens with it: **rotating `AUTH_SECRET` unpairs every device** |

## API routes
All under `/api`. All live in production (the Phase 2a rows since 2026-10-12). Everything except `health`, `version`, `auth/setup|login|refresh|test-login` and `pair/start|check` needs `Authorization: Bearer <token>`: a house access token (data scoped to its house) for the web routes and `pair/confirm`, a **device token** for `device/*` (house and device come from the verified token, never from the body).
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

## Versions
Production (main, 2026-10-12): webapp 0.1.39 · worker 0.1.39 · schema `0002_devices_pairings` · firmware 0.1.36 in the source (no firmware has been flashed to hardware since Phase 0). The Phase 4 branch tip moves ahead of these with every commit.

## Open questions (spec §0)
Q1 battery pin · Q2 touch-controller rail (spike: `docs/spikes/2026-09-deep-sleep-touch-wake.md`) · Q3 shipped with five avatar poses (A1, A4, B1, C1, C2), the two new poses still unmade · Q4 shipped as a per-install opaque `x-client-id` · Q5 shipped as `CAN_PRESETS` plus custom grams.

## Simulator
`pnpm --filter @feedme2/device-sim start pair|status|state|feed|log|sync|heartbeat|forget-local` (see `tools/device-sim/README.md`). State lives in `./device-sim.json` (gitignored); exit 2 means a transient sync stop, queues kept.

## Firmware
`firmware/` is PlatformIO; `src/{domain,ports,application,adapters,screens,assets}` (spec §5.1). Envs: `crowpanel` (hardware, GC9A01, `FEEDME2_BACKEND_URL` = the production worker), `simulator` (Wokwi, ILI9341 stand-in, `-DSIMULATOR=1`: `FakeNetwork` seeded from `fixtures/device-state.sample.json`, `SimulatedClock`, input from the serial command channel), `native` (host Unity tests over `domain/` + `application/` only: `cd firmware && pio test -e native`, 142 cases), `spike-sleep` (bench spike only). Flash: `cd firmware && pio run -e crowpanel -t upload` (then `pio device monitor`). Serial command channel (simulator only): one of `press | double | long | cw | ccw | touch` per line becomes the input event; every transition prints `[feedme2] <event> key=value …`, the contract table is in the Phase 2b handoff. Wokwi scenarios `firmware/wokwi/{boot,pair,feed,feed_all,system_menu}.scenario.yaml` assert those lines; CI's `firmware-hil2` matrix runs them with `wokwi/wokwi-ci-action` (all five passed with `WOKWI_CLI_TOKEN` set; the job skips with a warning, not a failure, when the token is unset). Pairing on the device: the Pair screen shows a QR to `/settings?pair=<code>#devices` and the six-digit code.

## Known limitations (Phase 2b)
Manual light sleep drops the Wi-Fi association (spec §5.5 says otherwise) and the USB-CDC console: after every nap the station disconnects and rejoins with its 15 s join budget, and a requested round holds the device awake for that long (`App::kJoinGraceMs`); a paired device with no reachable network dims and sleeps, and its timer wake retries. A stuck touch INT makes light sleep return at once (nap loop; bench item). Sync makes one HTTP request per loop tick (a round spans several ticks; the fetched state applies when the round ends), each over its own TLS connection. Only the backend's own 401 (`{"error":"unauthorized"}`) unpairs; any other 401 is transient (60 s retry). Menu unpair and a backend 401 both clear the cached house state. The captive portal opens by itself only on an unpaired device with no saved credentials and restarts the device after 10 idle minutes; otherwise it opens on a Press on the Wi-Fi screen or with the knob button held through boot. The cat PNG is re-decoded on every Idle rebuild (`LV_CACHE_DEF_SIZE 0`). `WifiNetwork` is `setInsecure()` (pinning: Phase 3). Generated cat sources are 268 KB (plan cap 250 KB; ~74 KB in flash). Wokwi scenarios run in CI only (not locally) and the crowpanel build has not been flashed to hardware. Details, decisions, bench items and the should-fix-before-Phase-3 list: the Phase 2b handoff.

## Known limitations (Phase 2a)
`/pair/start` is public and replaces the pending row for that device id (a nuisance, not a takeover: the poll secret protects the token). The confirm budget is read-then-record, so parallel guesses can exceed 10, and it is per house while `/auth/setup` is unlimited (anyone can mint houses). No per-device log rate limit. Devices clamp `fedAt`, the web rejects it. Details and follow-ups: the Phase 2a handoff.

## Known limitations (Phase 1)
No rate limiting anywhere (login is slowed only by PBKDF2; `/auth/setup` unlimited; body size capped only on `/api/logs`). Access tokens stay valid up to 15 min after logout or PIN change. Feedings with `fedAt` more than 5 min ahead are rejected (a fast phone clock loses them). Deploy watch item: PBKDF2 at 100k iterations may exceed the Workers Free-plan CPU limit; check the first production login. Details and follow-ups: the Phase 1 execution handoff.

## Log
- 2026-10-12 — PRs #2 (Phase 2a) and #3 (Phase 2b) merged; #3's merge run cancelled #2's, so 2a deployed only after a manual dispatch on main. Production: worker 0.1.39, schema `0002`; e2e 12 passed / 6 skipped; Wokwi HIL-2 5/5 green in CI. CI fixed (no cancelled main runs, diff from the last green run, dispatch deploys only main). Firmware paused (the device may change; Phase 3 on hold). Phase 4 Reports started on `feat/phase4-reports`.
- 2026-10-12 — Phase 2b whole-branch review (at `7a0d190`): two must-fixes, both landed: Wi-Fi (`1e8db93`: one request per TLS connection, rejoin after every light sleep, portal only without credentials plus a 10-minute idle timeout) and sync (`32fb7e5`: one request per tick, offline devices sleep, only the backend's 401 unpairs, menu unpair clears the cached state). Firmware 0.1.36, 142 native cases. Full verification, PR and the bench flash are next.
- 2026-10-11 — Phase 1 merged (PR #1) and deployed; production e2e 12 passed / 5 skipped. Phase 2a (device API + simulator) and 2b (firmware MVP) plans written.
- 2026-10-11 — Phase 1 tasks 1–17 implemented, reviewed and fixed on `feat/phase1-core`; Task 18 docs and full verification green (shared 57, backend 153, webapp 368, scripts 42, firmware native 8). Push, PR and the decisions pending for Andrey are next.
- 2026-09-21 — CI secrets set; `workflow_dispatch` run green (shared, backend, webapp, firmware); Phase 0 complete. WOKWI_CLI_TOKEN not set yet, so the Wokwi step skipped.
- 2026-09-20 — spec approved; Phase 0 started.
- 2026-09-20 — Phase 0 tasks 1–16, 18, 19 implemented and reviewed; merged to main.
- 2026-09-21 — D1, R2 and the Pages project provisioned; first deploy from the workstation; /api/version live through the proxy; e2e 9/9 against production.
