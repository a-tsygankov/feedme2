# Phase 2a execution handoff — 2026-10-11

Branch `feat/phase2a-device-api` (about 20 commits ahead of `origin/main`, not pushed, no PR yet). Plan: `docs/superpowers/plans/2026-10-11-phase2a-device-api.md` (all steps ticked; Task 12 Step 3, push and PR, is the dispatcher's). Spec: `docs/superpowers/specs/2026-09-20-feedme2-design.md` §3.1–3.4, §5.3, §5.7. Live state: `handoff.md`.

## What was built

One line per plan task; the SHA is the feature commit, with the follow-up fix commits after it.

| Task | What | Commits |
|---|---|---|
| plan | Phase 2a and 2b implementation plans, Phase 1 marked merged | `4d0a210` |
| 0 | Phase 1 carry-overs: console `minLevel` filter, logout revokes the rotated child token | `b488736` |
| 1 | Migration `0002` (devices, pending pairings, later pair attempts) and the schema drift guard | `0dfbc12`, `acdf19f`; reshaped in place by `a8a692f` (0002 was unmerged) |
| 2 | Shared device contracts and `fixtures/device-state.sample.json` | `0ebbb4b` |
| 3 | Device tokens (365-day JWT), devices repo, `requireDevice()` | `f2c5675` |
| 4 | Pairing handshake: `pair/start`, `pair/check`, `pair/confirm` with six-digit codes | `964a43e`; hardened by `a8a692f`, `52ac0c5` |
| 5 | Devices routes: list, rename, forget | `ced5953` |
| 6 | `GET device/state` with ETag/304 and `tzOffsetMin` | `e1e7e30` |
| 7 | `POST device/feedings` with clock clamping | `72f0f7a` |
| 8 | `POST device/heartbeat`, `POST device/logs` | `194a3de` |
| 9 | Webapp Devices section in Settings, pair-by-code, rename, forget | `aaf5d42`; fixes `425ee38` (scrollIntoView guard), `9ce03ab` |
| 10 | `tools/device-sim` fake device and CLI | `0c99b8a`; fixes `9ce03ab`, `a8a692f` |
| 11 | System e2e pairing a simulated device; CI runs the simulator tests | `c667a88` |
| review | Per-pairing token ids, poll secret with single delivery, atomic confirm, DST-aware ETag, confirm budget | `a8a692f` |
| review | Releasing a pairing claim also clears `delivered_at` | `52ac0c5` |
| 12 | Docs, this handoff, the 2b plan contract update; workflow gates, 429 message, pair body limits, `fedAt` 0, sim secret guard (code agent) | the docs commit that added this file, plus the code agent's commits |

## How it was verified

Full verification run before the push on 2026-10-11 (`pnpm -r typecheck && pnpm -r test`, scripts, firmware native, version check — all green): shared **68**, backend **217**, device-sim **15**, webapp **384**, scripts (version tooling) **42**, firmware native **8**. Local Playwright e2e against wrangler dev (`E2E_BASE_URL=http://127.0.0.1:5173 E2E_REQUIRE_AUTH=1`): **18/18**, including the pairing of a simulated device. The simulator CLI also drove a real pairing by hand (`pair`, confirm in the web app, `feed`, `sync`). Whole-branch review verdict: mergeable; its must-fixes were applied by the code agent in Task 12.

## Deviations from the plan worth knowing

- **Poll secret and single delivery.** `pair/start` and `pair/check` are public and the device id is not a secret, so anyone polling `check` for a pending device could have collected its token. The device now picks a `pollSecret` (hex, 32–64 chars) at `start`; the row stores its SHA-256 (`poll_secret_hash`); `check` answers only `pending` to anyone else. The token is served to the holder once, with a 60 s redelivery for a lost response, then wiped (`delivered_at`, `expired`). `confirm` extends the row's expiry by a 2 min delivery grace. Expiry is checked before the confirmed branch.
- **`jti` = `devices.token_id`.** Each pairing writes a fresh `token_id` (migration 0002, regenerated in `upsertPaired`); the JWT carries it as `jti`; `requireDevice` rejects a token whose `jti` does not match the row. Forget then re-pair of the same device (even into the same house) cannot revive an older token.
- **Atomic confirm.** One `UPDATE pending_pairings ... WHERE pair_code = ? AND confirmed_at IS NULL AND expires_at > ? RETURNING` claims the code, and the device upsert is conditional (revoked, or same house). A device still live in another house gives 409 `device_in_use` and the claim is released (`52ac0c5` also clears `delivered_at`). A concurrency test pins exactly one 201.
- **`pair_attempts`.** A table (house, window start, failures) caps failed confirms at 10 per 10 min per house, then 429 `too_many_attempts` with `Retry-After`. Successes do not count.
- **`tzOffsetMin` in the state and ETag.** The device state carries the house's UTC offset at `now`, so the firmware can format local times; the weak ETag covers it (not `now`), so a DST change invalidates a cached state. Pinned with a New York 2026-11-01 test through a clock spy.
- **`clampFedAt` policy.** Devices have no UI to fix a timestamp, so `device/feedings` corrects a clearly wrong clock instead of refusing: a `fedAt` more than 5 min ahead, or before 2020-01-01, becomes the server's now and its id is listed in `clamped`. A real offline backlog is never rewritten. `fedAt` 0 is allowed (a device that has not synced its clock yet). The web route keeps rejecting future times (`fedat_in_future`).
- **`setRequestOrigin`.** `requireDevice` sets the request-context origin (house and device) after the row check, so the console's device filter shows the worker lines a device caused; `index.ts` attributes house tokens only. The middleware's last-seen touch is best effort (try/catch) and skipped on `/heartbeat`.
- **Body limits.** `device/feedings` 64 KB, `device/heartbeat` 4 KB, `device/logs` 128 KB; the public pair routes are capped at 1 KB. Device log entries have `clientId` stripped.
- **Webapp.** `ApiInit` bodies may be thunks, evaluated after any stale-token refresh (sign-out reads the rotated refresh token). `DeviceResponseSchema` (`{ device }`) is exported from shared. `scrollIntoView` calls are guarded for environments without it (jsdom, old WebViews). The pair link `/settings?pair=<code>#devices` survives login (the redirect keeps path, search and hash).
- **Simulator CLI exit codes.** 0 ok, 1 error (bad input, 4xx such as a forgotten device's 401, network failure), 2 for `sync` when a transient failure (network, 5xx, 408, 429) cut the round short and the queues were kept. The snapshot is written atomically and stores the API base and the poll secret; read-only commands do not save.
- **Migration 0002 was edited in place** by the security batch (`a8a692f`), which is allowed only because it had not been merged. From the merge on it is frozen.

## Decisions pending for Andrey

1. **Confirm budget design.** It is per house and read-then-record, so parallel guesses can exceed 10 before the counter lands, and `/auth/setup` is unlimited, so someone can mint houses and get a fresh budget each. Accept for a household app, or move to an atomic UPSERT plus a per-IP counter.
2. **`/pair/start` replaces a pending row for that device id.** A third party who knows a device id can reset its pairing in progress (a nuisance, not a takeover, since the poll secret guards the token). Accept, or refuse a `start` while an unexpired row exists with a different secret.
3. **Devices clamp `fedAt`, the web rejects it.** Chosen so a device with a wrong RTC does not lose feedings; the web keeps its stricter rule so a fast phone clock stays visible as an error. Say if the web should clamp too.

## Follow-ups (none blocking)

- Atomic budget UPSERT for `pair_attempts` and a per-IP counter (decision 1).
- Per-device log rate limit (a paired device can still fill its house's 5 000-row log buffer).
- The simulator's message for a snapshot written before the poll-secret/API-base fields existed should say "re-pair" instead of a generic parse error.
- `WOKWI_CLI_TOKEN` is still unset, so the Wokwi step skips.

## Process notes

- Several agents shared one checkout: pathspec-only staging, the commit lock (`mkdir .git/feedme2-commit.lock`), never `git add -A`.
- The 2b firmware plan was updated in this phase to the poll-secret contract: `INetwork::pairStart/pairCheck` take `pollSecret`, `IRandom::hex`, `PairCoordinator` generates a fresh secret per `start()` and restarts on `unknown` and after 10 min pending, `SyncService` syncs the clock from the heartbeat `{now}`, the draft key set is pinned, `FakeNetwork` enforces the secret.

## Next steps

1. Push `feat/phase2a-device-api` and open the PR **"Phase 2a: device API + simulator"** (body in plan Task 12 Step 3).
2. Watch CI: version check, shared/backend/webapp/device-sim tests, preview smoke, **the full e2e including migration 0002**, firmware build.
3. Merge to `main`: the deploy applies `0002_devices_pairings.sql` to remote D1 and ships the worker and webapp. Check the migration step in the run before trusting the rest.
4. Verify production: `GET /api/version` shows the new worker and schema; the simulator can pair against production (use a real house) and `status` shows the device in Settings.
5. Then Phase 2b (firmware MVP) from the updated plan; the deep-sleep bench spike and `WOKWI_CLI_TOKEN` remain open.
