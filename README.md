# feedme2

Household cat-feeding tracker: a knob-driven ESP32 dial (Elecrow CrowPanel 1.28"), a PWA, and a Cloudflare Worker. Design: `docs/superpowers/specs/2026-09-20-feedme2-design.md`.

## Layout

| Dir | What | Deploys to |
|---|---|---|
| `shared/` | zod schemas, ring buffer, version compare (TS only) | bundled into both |
| `backend/` | Hono Worker + D1 | `feedme2-api.atsyg-feedme.workers.dev` |
| `webapp/` | React 18 + Vite PWA | `feedme2-webapp.pages.dev` |
| `firmware/` | PlatformIO / LVGL 9 for CrowPanel | flashed over USB, later OTA |
| `fixtures/` | cross-tier test vectors (amount units, hunger levels): pinned by the shared tests, to be read by the firmware port | not deployed |

## Getting started

```bash
pnpm install                      # also installs the pre-commit version-bump hook
cp backend/.dev.vars.example backend/.dev.vars
pnpm db:migrate:local
pnpm dev:backend                  # wrangler dev on :8787
pnpm dev:webapp                   # vite on :5173, proxies /api to :8787
pnpm test                         # shared + backend + webapp unit tests
python -m unittest discover -s scripts   # version tooling
cd webapp && pnpm test:e2e        # Playwright against E2E_BASE_URL (default: production; signed-in specs skip there)
cd firmware && pio test -e native && pio run -e crowpanel && pio run -e simulator
```

First run: open http://localhost:5173, which sends you to `/setup` to create a house (name and PIN). That lands on `/` (the dashboard); add your cats and tune amounts and thresholds under `/settings`, then feed from the dashboard. Later visits go through `/login`.

Full local end-to-end (the signed-in specs need the dev-only `/api/auth/test-login`, which is why `.dev.vars` must come from the example, with `ENVIRONMENT=development`): run `pnpm dev:backend` (wrangler on :8787) and `pnpm dev:webapp` (vite on :5173), then

```bash
cd webapp && E2E_BASE_URL=http://127.0.0.1:5173 E2E_REQUIRE_AUTH=1 pnpm test:e2e
```

`E2E_REQUIRE_AUTH=1` turns a missing test-login into a failure instead of a skip (CI sets it).

The pre-commit hook needs a working `python`/`python3`/`py`; without one it skips the bump and CI's version check catches it. PlatformIO (`pip install platformio`) provides `pio`.

## Versioning

Each tier has its own version, bumped automatically on commit for the tiers the staged diff touches. See `CLAUDE.md`.

## Hidden console

Tap the logo three times to open the debug console: tier versions and the merged client, worker and device logs (filters, live mode, copy and download). It reads `/api/debug/logs`, scoped to the signed-in house.
