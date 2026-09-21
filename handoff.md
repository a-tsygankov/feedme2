# feedme2 — state of the world

Single page. Update at the end of any session that changes phase, adds a resource, or resolves a spec open question.

## Phase
Phase 0 (foundation) implemented locally on `feat/phase0-foundation` (tasks 1–16, 18, 19); provisioning, first deploy and the PR (tasks 17, 20) wait on Andrey's credentials. Plan: `docs/superpowers/plans/2026-09-20-phase0-foundation.md`. Execution handoff: `docs/handoffs/2026-09-20-phase0-execution-handoff.md`.

## Resources (names are decided; nothing is provisioned or deployed yet — see the execution handoff)
| Thing | Name / URL | Notes |
|---|---|---|
| Worker | `feedme2-api` → https://feedme2-api.atsyg-feedme.workers.dev | deployed by `.github/workflows/deploy.yml` on push to main |
| Pages | `feedme2-webapp` → https://feedme2-webapp.pages.dev | per-branch previews `<branch>.feedme2-webapp.pages.dev` |
| D1 | `feedme2-db` (id in `backend/wrangler.toml`) | migrations via `wrangler d1 migrations apply` |
| R2 | `feedme2-firmware` | OTA binaries (Phase 3) |
| GitHub secrets | `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `WOKWI_CLI_TOKEN` | set with `scripts/setup-secrets.local.ps1 -GitHub` |
| Worker secrets | `AUTH_SECRET` | set with `scripts/setup-secrets.local.ps1 -Cloudflare` |

## Open questions (spec §0)
Q1 battery pin · Q2 touch-controller rail (spike: `docs/spikes/2026-09-deep-sleep-touch-wake.md`) · Q3 two new cat poses · Q4 web client id · Q5 can-size presets.

## Log
- 2026-09-20 — spec approved; Phase 0 started.
- 2026-09-20 — Phase 0 tasks 1–16, 18, 19 implemented and reviewed; wrangler session expired, so D1/R2/Pages provisioning and the first deploy are pending.
