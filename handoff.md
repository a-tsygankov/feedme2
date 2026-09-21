# feedme2 — state of the world

Single page. Update at the end of any session that changes phase, adds a resource, or resolves a spec open question.

## Phase
Phase 0 (foundation) **complete** on 2026-09-21: merged to `main`, provisioned, deployed by CI (run 35561561511 green across all tiers). Open item: the deep-sleep bench spike (`docs/spikes/2026-09-deep-sleep-touch-wake.md`). Next: Phase 1 plan. Plan: `docs/superpowers/plans/2026-09-20-phase0-foundation.md`. Execution handoff: `docs/handoffs/2026-09-20-phase0-execution-handoff.md`.

## Live resources (provisioned and first-deployed 2026-09-21)
| Thing | Name / URL | Notes |
|---|---|---|
| Worker | `feedme2-api` → https://feedme2-api.atsyg-feedme.workers.dev | deployed by `.github/workflows/deploy.yml` on push to main |
| Pages | `feedme2-webapp` → https://feedme2-webapp.pages.dev | per-branch previews `<branch>.feedme2-webapp.pages.dev` |
| D1 | `feedme2-db` (`26f85bd9-ebb1-4bd3-9798-8cbd420481e3`) | migrations via `wrangler d1 migrations apply` |
| R2 | `feedme2-firmware` | OTA binaries (Phase 3) |
| GitHub secrets | `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `WOKWI_CLI_TOKEN` | set with `scripts/setup-secrets.local.ps1 -GitHub` |
| Worker secrets | `AUTH_SECRET` | set with `scripts/setup-secrets.local.ps1 -Cloudflare` |

## Open questions (spec §0)
Q1 battery pin · Q2 touch-controller rail (spike: `docs/spikes/2026-09-deep-sleep-touch-wake.md`) · Q3 two new cat poses · Q4 web client id · Q5 can-size presets.

## Log
- 2026-09-21 — CI secrets set; `workflow_dispatch` run green (shared, backend, webapp, firmware); Phase 0 complete. WOKWI_CLI_TOKEN not set, so the Wokwi step skips.
- 2026-09-20 — spec approved; Phase 0 started.
- 2026-09-20 — Phase 0 tasks 1–16, 18, 19 implemented and reviewed; merged to main.
- 2026-09-21 — D1, R2 and the Pages project provisioned; first deploy from the workstation; /api/version live through the proxy; e2e 9/9 against production. 
