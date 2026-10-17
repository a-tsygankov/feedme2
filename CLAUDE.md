# feedme2 — agent rules

Spec: `docs/superpowers/specs/2026-09-20-feedme2-design.md`. Plans: `docs/superpowers/plans/`. Live state: `handoff.md` (one page, update when a phase changes or a URL/resource is added).

## Layout
- `shared/` TypeScript-only workspace package (`@feedme2/shared`): zod API contracts (incl. the device and pairing contracts in `shared/src/device.ts`), units and hunger rules, ring buffer, version compare. Imported by backend and webapp as source.
- Single homes in `shared/src/`: `zone.ts` for all house-zone calendar math (the dashboard day boundary and reports both use it; never the browser's zone), `reports.ts` for report aggregation, `csv.ts` for CSV. `shared/src/testing/` (the seeded month) is test-only and never exported from `index.ts`.
- Report queries live under the `["report"]` key root, never `["feedings"]` (the dashboard rewrites that root as `Feeding[]`). `["report"]` is invalidated after a sync that sent feedings, a cat-page edit or delete, and any house or cat settings change.
- `backend/` Hono Worker `feedme2-api` on D1 `feedme2-db`. Migrations are hand-written numbered SQL in `backend/migrations/`; never edit one in place, add a new one.
- `webapp/` React 18 + Vite 5 PWA on Pages `feedme2-webapp`. `/api/*` is proxied by `functions/api/[[path]].ts`. No `dark:` Tailwind utilities: theming is the token layer in `src/styles/tokens/` plus `data-theme` on `<html>`.
- `tools/device-sim/` workspace package (`@feedme2/device-sim`, not deployed): imports `shared/` as source, speaks `/api/pair/*`, `/api/device/*` and `/api/auth/login-token-create` like the firmware will, and is used by the Playwright system e2e. Its CLI is documented in its README.
- `fixtures/` cross-tier test vectors (`unit-vectors.json`, `hunger-vectors.json`, `device-state.sample.json`); counts for the firmware tier, so a change here bumps firmware. `shared/src/{units,hunger}.ts` are the only homes for those rules; the webapp imports them, and `firmware/src/domain/{Units,Hunger}.h` are pinned to the vectors by the Unity tests through `firmware/test/fixtures.h` (relative path `../fixtures/`, so native tests run from `firmware/`).
- `POST /api/auth/test-login` exists only where `ENVIRONMENT` is `development` or `test` (fail closed). Signed-in e2e specs use it via `requireTestAuth`; `E2E_REQUIRE_AUTH=1` turns a skip into a failure (CI sets it).
- Backend errors: validation failures are `{error:"invalid_request", issues:[{path,message}]}` (400); every other error is `{error:"<code>"}` (new codes are snake_case; a few Phase 1 ones are still phrases such as `not found` and `name taken`).
- `firmware/` PlatformIO, `src/{domain,ports,application,adapters,screens,assets}`. `domain/` **and** `application/` must stay free of Arduino, LVGL and ESP-IDF headers (they are what `pio test -e native` compiles; ArduinoJson is allowed there). ESP32 code goes in `adapters/`, LVGL in `screens/`. Envs: `crowpanel` (hardware), `simulator` (Wokwi, `-DSIMULATOR=1`), `native` (tests), `spike-sleep` (bench spike only). The `[feedme2] <event> key=value …` serial lines are a contract asserted literally and in order by `firmware/wokwi/*.scenario.yaml` (table in the Phase 2b handoff): never reword, add fields in front of, or reorder one without updating the scenarios.

## Versioning
Four tiers, each auto-bumped by `.githooks/pre-commit` (`scripts/bump_versions.py`) and enforced on PRs by `scripts/check_version_bump.py`: webapp (`webapp/package.json`), worker (`backend/package.json`), schema (new file in `backend/migrations/`), firmware (`firmware/src/application/Version.h`). `shared/` changes bump webapp and worker (and also affect `tools/device-sim`, which has no version of its own). `tools/` is not a tier. Doc-only changes bump nothing.

## Rules
- Device routes (`/api/device/*`) take `houseId` and `deviceId` only from `requireDevice()` (the verified token plus the live `devices` row), never from the body or query.
- Device tokens carry `jti` = `devices.token_id`, regenerated on every pairing: a forget or re-pair invalidates every older token. `AUTH_SECRET` signs them too, so rotating it unpairs every device.
- QR login codes (`login_qr_tokens`) are stored hashed, consumed once by one conditional `UPDATE … RETURNING`, and bound to the pairing's `devices.token_id` at mint: a forget or re-pair kills them. Every refused `/api/auth/login-qr` is the same 401.
- The `/qr` link carries the code in the fragment (`/qr#deviceId=…&token=…`, never the query, so no server log or Referer sees it); `/qr` scrubs it from the address bar before the exchange and asks before moving a phone signed in to another house.
- Help topics (`webapp/src/help/scenarios/`) target `data-testid`s through `webapp/src/help/targets.ts`: renaming or removing a test id breaks a tour, and the `help` Playwright project (PR CI, local stack only) catches it on the branch CI takes; grep `webapp/src/help/` before touching one. Tours never type or write (highlights, plus a click only for harmless navigation), branch only on what a screen positively shows (`target-visible`), and pin their CI branches in `expectedCiBranches`. How to add one: `docs/help/README.md`.
- Migrations `0002` (Phase 2a) and `0003` (Phase 5a) were edited in place only while unmerged. After a migration reaches `main` never edit it; add a new numbered file.
- TDD: failing test first, then the minimal code. Comments explain *why* and name the incident when there is one.
- Integers only in D1 (epoch-ms, milligrams). Client-generated UUID primary keys.
- Never print secret values. `scripts/setup-secrets.ps1` is committed with placeholders; the real copy is `scripts/setup-secrets.local.ps1` (gitignored).
- Cloudflare account: the one whose workers.dev subdomain is `atsyg-feedme`. Names: `feedme2-api`, `feedme2-webapp`, `feedme2-db`, `feedme2-firmware`.
- Commit messages: lowercase conventional style with scope (`feat(webapp): …`), ending with the Co-Authored-By line from the session reminder.
