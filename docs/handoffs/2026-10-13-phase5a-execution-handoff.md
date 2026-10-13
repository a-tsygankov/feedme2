# Phase 5a execution handoff — 2026-10-13

Branch `feat/phase5a-qr-login`, stacked on `feat/phase4-reports` while PR #4 was open; Phase 4 has since merged (`f126630`), so the branch's own commits are exactly `origin/main..HEAD` and its PR targets `main`. The branch holds the plan commit `7d30821`, five task commits from `a62434b` to `ad46c83`, three security-review fix commits (`101a9c1`, `de040ce`, `29c3587`) and this docs commit. Not pushed; no PR yet. Plan: `docs/superpowers/plans/2026-10-12-phase5a-qr-login.md` (Tasks 1–5 and Task 6's docs step ticked; verification and the PR are the dispatcher's). Spec: `docs/superpowers/specs/2026-09-20-feedme2-design.md` D1, §1.3, §3.1–§3.4, §4.1, §5.2, §7 row 5. Live state: `handoff.md`.

## Before this phase: Phase 4 merged and deployed

PR a-tsygankov/feedme2#4 (Reports) merged on 2026-10-12 and deployed. Production now serves worker 0.1.47 and webapp 0.1.57. The schema is still `0002_devices_pairings`, because Phase 4 added no migration. The production e2e run gave 12 passed and 8 skipped; the signed-in specs skip because production has no test-login. The PR needed two CI-only fixes: `aa9b76e` (the chart `sr-only` tables made `/reports` wider than a phone) and `6ec5eae` (every restored query now refetches after hydration). Both are described in the Phase 4 handoff. The merge's deploy was the first under the new CI guards, and it diffed from the last green run as designed.

## What was built

| Task | What | Commits |
|---|---|---|
| 1 | Migration `0003_login_qr_tokens.sql`: `token_hash` (SHA-256 hex, PK), `device_id`, `house_id`, `device_token_id`, `created_at`, `expires_at`, `consumed_at`, with indexes on device and expiry. Also the Drizzle mirror and drift guard, and in shared: `LOGIN_QR_TTL_SEC = 60`, `LoginQrTokenSchema` (43 base64url chars), `LoginQrBodySchema` (strict), `LoginTokenCreateResponseSchema` | `a62434b`; `device_token_id` and the `house_id` CHECK in `101a9c1` |
| 2 | `LoginQrTokensRepo` (`create` deletes the device's older rows and inserts the new one in one batch; `consume` is one conditional `UPDATE … RETURNING`; `pruneExpired` is chunked and runs an hour past expiry) and `backend/src/routes/login-qr.ts`, mounted at `/api/auth`. `POST /login-token-create` takes a device token via `requireDevice()` and returns `{token, expiresInSec: 60}`. `POST /login-qr` is public, has `publicBodyLimit` (1 KB → 413), consumes the code, re-checks the device row, issues house tokens and returns a uniform 401 otherwise. The hourly cron prunes the table. `issueTokens` moved to `backend/src/auth/issue.ts` and `publicBodyLimit` to `backend/src/middleware/body-limit.ts` | `3e91c39`; pairing binding and log attribution in `101a9c1` |
| 3 | device-sim: `DeviceSim.loginToken()`, `loginUrl(webBase, token)`, and the CLI `login-qr [--web <base>]` (an unpaired sim exits 1; the token is never saved) | `94dbc1b`; fragment URL in `29c3587` |
| 4 | `/qr` landing (`webapp/src/screens/QrLogin.tsx`, public route like `/login`) and `api.loginQr`. It shows "isn't valid" for a malformed code, "expired or was already used" with a PIN sign-in link for a 401, and "No connection" with Retry for a network failure. It makes one call under StrictMode | `8702775`; fragment, scrub-first, confirm and the epoch bump in `de040ce` |
| 5 | Exit test `webapp/e2e/qr-login.spec.ts`. A simulated device pairs and mints a code. A fresh phone opens the URL and lands on the dashboard with no query or hash. A third phone gets the refusal on a bare `/qr` with no horizontal overflow. A fourth phone, signed in to another house, sees the confirm, taps Switch and lands on the device's house | `ad46c83`; extended in `de040ce` |
| 6 | This handoff, `handoff.md`, the README QR login section, CLAUDE.md rules, and the plan ticks and corrections | this commit |

## How it works (end to end)

1. A paired device calls `POST /api/auth/login-token-create` with its device token. The Worker takes house, device and `token_id` from `requireDevice()` and deletes that device's older codes. It mints 32 random bytes (base64url, 43 chars) and stores only the SHA-256, together with `devices.token_id` at that moment. It returns the plaintext once, with `expiresInSec: 60`. The log line carries the device id, never the token.
2. The device shows a QR of `https://feedme2-webapp.pages.dev/qr#deviceId=<32 hex>&token=<43 chars>`. Until the firmware screen exists, `device-sim login-qr` prints that URL.
3. `/qr` reads the fragment. It falls back to the query when there is no fragment. It copies both values into state and replaces the URL with a bare `/qr` on mount, before any request.
4. If the phone is already signed in, `/qr` asks: "You're signed in to X. Sign in to the device's house instead?" **Stay** goes to `/` and does not spend the code. **Switch** continues.
5. `POST /api/auth/login-qr {deviceId, token}` (public, ≤ 1 KB). One `UPDATE login_qr_tokens SET consumed_at = now WHERE token_hash = ? AND device_id = ? AND consumed_at IS NULL AND expires_at > now RETURNING house_id, device_token_id` claims the code. The device row must exist, must not be revoked, and must have the same `house_id` and the same `token_id`. The house must exist. Any failure returns 401 `{"error":"unauthorized"}`.
6. On success the request origin is set to that house and device, `qr login` is logged into the house's feed, and the Worker returns an ordinary `TokensResponse`: a 15-minute access token and a 30-day refresh token.
7. The webapp calls `authStore.applyTokens`, which bumps the session epoch. `main.tsx`'s `crossesSessionBoundary` clears the old house's cached data. The page then navigates to `/` with `replace`.

## How it was verified

- **TDD per task.** Each task wrote its failing tests first. Each package's tests and typecheck ran before the commit.
- **Backend** `test/login-qr.test.ts` (9 cases):
  - one sign-in then a 401
  - two simultaneous scans give exactly one 200
  - 60 001 ms after minting gives a 401
  - a forgotten device gives a 401
  - a re-pair (new `token_id`) gives a 401
  - the `qr login` line is in the house's log feed
  - a code is bound to its device id and replaced by a newer code
  - a house token cannot create a code; bad bodies return 400 and an unknown code returns 401
  - the hourly prune removes the codes
- **Webapp** `QrLogin.test.tsx` (11 cases):
  - the fragment and query forms
  - a 401, a malformed code and a network failure with Retry
  - one call under StrictMode
  - the URL is scrubbed before the exchange
  - signed in elsewhere: the confirm with Switch, and Stay without spending the code
- **Auth store** `auth-store.test.ts`: covers the epoch bump. A refresh that is in flight when `applyTokens` runs neither restores the old house nor, on its 401, signs out the new one.
- **Shared and device-sim**: `device.test.ts` and `sim.test.ts`/`cli.test.ts` cover the contracts and the fragment URL.
- **Security review** (whole branch, after `ad46c83`): **no must-fix.** Every should-fix and nit landed:
  1. A code is bound to the device's **pairing** (`device_token_id` = `devices.token_id` at mint), not just to its house. A re-pair within the minute kills older codes even when the device stays in the same house (`101a9c1`).
  2. `login_qr_tokens.house_id` has a `length = 36` CHECK, like the other house columns (`101a9c1`).
  3. A successful exchange sets the request origin before it logs `qr login`. Before, the line was dropped as an anonymous info line. A refused scan still writes nothing into any house's feed (`101a9c1`).
  4. The code moved from the **query to the fragment**, so no server log or `Referer` header ever sees it (`de040ce`, `29c3587`).
  5. The URL is **scrubbed before the exchange**, not after it. A failed, offline or abandoned sign-in no longer leaves a live code in the address bar or history (`de040ce`).
  6. A phone signed in to another house is **asked before switching**. This mitigates login CSRF: a link could otherwise silently move a phone into an attacker's house and capture what it logs (`de040ce`).
  7. `applyTokens` **bumps the auth-store epoch**. This closes the race where a refresh for the old house finished after the switch (`de040ce`).
  8. The e2e asserts that final URLs carry neither query nor hash, and it covers the confirm path. `newPhone` casts `project.use` so the spec typechecks under `exactOptionalPropertyTypes` (`de040ce`).
  9. The device-sim builds the fragment URL. Its README documents the scrub and the confirm (`29c3587`).
- **Exit test**: local full-stack e2e **21/21** (wrangler dev and vite, `E2E_REQUIRE_AUTH=1`) after the fix batch, `qr-login.spec.ts` included.
- **Unit counts** (re-run for this docs commit: `pnpm -r test`, `python -m unittest discover -s scripts`): shared **114**, backend **235**, webapp **474**, device-sim **22**, scripts **45**. All passed.

Not run in this phase: CI on the branch (not pushed), the production e2e, and Task 6's full `pnpm -r typecheck && … check_version_bump.py` command.

## Decisions taken beyond the spec

1. **The fragment URL replaces the query URL in the spec.** Spec §4.1 says `/qr ?deviceId=&token=`; the QR now carries `/qr#deviceId=…&token=…`. This is recorded as a **spec correction**, pending Andrey. `/qr` still accepts the query form.
2. **The spec's `login_qr_tokens.token` column is `token_hash`.** The table stores only the SHA-256, like `refresh_tokens` and `pending_pairings.poll_secret_hash`, and it gains `device_token_id`.
3. **One live code per device.** A new create deletes the older codes, so a photographed QR dies as soon as the device shows the next one.
4. **Every refusal is the same 401**, so the endpoint reveals nothing about which codes or devices exist. A 400 only means a malformed body.
5. **Confirm before switching houses**, instead of the plan's silent switch (Review Focus 4).
6. **Used and expired codes stay an hour** past expiry so a failed scan can be looked into. Then the hourly cron deletes them in chunks of 500.

## Known limitations (Phase 5a)

- **There is no device screen yet.** Spec §5.2 "Login QR (60 s)" in the System menu waits for the firmware pause to end; `device-sim login-qr` stands in.
- **The old house's session is dropped only locally on a QR switch.** Its refresh token stays valid on the server until it expires (30 days) or is rotated; see decision pending 2.
- **`/auth/login-qr` has no rate limit** other than the 1 KB body cap. Guessing a code means hitting 256 random bits for a live device within its minute.
- An expired code and an already-used code show the same message, by design (the uniform 401).

## Decisions pending for Andrey

1. **The fragment URL as a spec correction.** Should spec §4.1 be amended to `/qr#deviceId=&token=`, and should the query form be dropped once the firmware ships? No device has minted a query-form link yet.
2. **Revoke the old house's refresh token on a QR switch?** Today `applyTokens` replaces the session locally and the old refresh token is not revoked. A server-side revoke would need `/qr` to call `POST /api/auth/logout` for the old session before or after the exchange.

## Plan corrections

These are recorded in the plan under "Corrections recorded during execution":
- the fragment URL
- the scrub before the exchange
- the confirm step
- the `token_id` binding
- the epoch bump
- the log attribution
- `0003` edited in place before merge (it is on no `main` yet)
- `issueTokens` moved to `backend/src/auth/issue.ts` and `publicBodyLimit` to `backend/src/middleware/body-limit.ts`
- the `token` → `token_hash` column

## Process notes

- Several agents shared one checkout. They staged by pathspec only, under the commit lock (`mkdir .git/feedme2-commit.lock`), and never ran `git add -A`.
- The hook bumped the tiers that each staged diff touched. From `main` after PR #4: webapp 0.1.57 → **0.1.61**, worker 0.1.47 → **0.1.50**, schema `0002` → **`0003_login_qr_tokens`**. Firmware is untouched at 0.1.36 because firmware is paused. `tools/` and docs bump nothing.

## Next steps

1. Task 6 verification: `pnpm -r typecheck && pnpm -r test && python -m unittest discover -s scripts && BASE_REF=origin/main python scripts/check_version_bump.py`.
2. Push and open **"Phase 5a: QR login"** against `main`. CI runs the full-stack e2e. Merging applies migration `0003` in production; after the deploy, run the production e2e.
3. Andrey: the two pending decisions above.
4. **Phase 5b: help tours.** Port gigsy's executable help. Its plan will be committed separately.
