# feedme2 — agent rules

Spec: `docs/superpowers/specs/2026-09-20-feedme2-design.md`. Plans: `docs/superpowers/plans/`. Live state: `handoff.md` (one page, update when a phase changes or a URL/resource is added).

## Layout
- `shared/` TypeScript-only workspace package (`@feedme2/shared`): zod schemas, ring buffer, version compare. Imported by backend and webapp as source.
- `backend/` Hono Worker `feedme2-api` on D1 `feedme2-db`. Migrations are hand-written numbered SQL in `backend/migrations/`; never edit one in place, add a new one.
- `webapp/` React 18 + Vite 5 PWA on Pages `feedme2-webapp`. `/api/*` is proxied by `functions/api/[[path]].ts`. No `dark:` Tailwind utilities: theming is the token layer in `src/styles/tokens/` plus `data-theme` on `<html>`.
- `firmware/` PlatformIO. `domain/` has no Arduino includes (host-tested by `pio test -e native`). Envs: `crowpanel` (hardware), `simulator` (Wokwi), `native` (tests), `spike-sleep` (bench spike only).

## Versioning
Four tiers, each auto-bumped by `.githooks/pre-commit` (`scripts/bump_versions.py`) and enforced on PRs by `scripts/check_version_bump.py`: webapp (`webapp/package.json`), worker (`backend/package.json`), schema (new file in `backend/migrations/`), firmware (`firmware/src/application/Version.h`). `shared/` changes bump webapp and worker. Doc-only changes bump nothing.

## Rules
- TDD: failing test first, then the minimal code. Comments explain *why* and name the incident when there is one.
- Integers only in D1 (epoch-ms, milligrams). Client-generated UUID primary keys.
- Never print secret values. `scripts/setup-secrets.ps1` is committed with placeholders; the real copy is `scripts/setup-secrets.local.ps1` (gitignored).
- Cloudflare account: the one whose workers.dev subdomain is `atsyg-feedme`. Names: `feedme2-api`, `feedme2-webapp`, `feedme2-db`, `feedme2-firmware`.
- Commit messages: lowercase conventional style with scope (`feat(webapp): …`), ending with the Co-Authored-By line from the session reminder.
