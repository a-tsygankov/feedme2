# feedme2

Household cat-feeding tracker: a knob-driven ESP32 dial (Elecrow CrowPanel 1.28"), a PWA, and a Cloudflare Worker. Design: `docs/superpowers/specs/2026-09-20-feedme2-design.md`.

## Layout

| Dir | What | Deploys to |
|---|---|---|
| `shared/` | zod schemas, ring buffer, version compare (TS only) | bundled into both |
| `backend/` | Hono Worker + D1 | `feedme2-api.atsyg-feedme.workers.dev` |
| `webapp/` | React 18 + Vite PWA | `feedme2-webapp.pages.dev` |
| `firmware/` | PlatformIO / LVGL 9 for CrowPanel | flashed over USB, later OTA |

## Getting started

```bash
pnpm install                      # also installs the pre-commit version-bump hook
cp backend/.dev.vars.example backend/.dev.vars
pnpm db:migrate:local
pnpm dev:backend                  # wrangler dev on :8787
pnpm dev:webapp                   # vite on :5173, proxies /api to :8787
pnpm test                         # shared + backend + webapp unit tests
python -m unittest discover -s scripts   # version tooling
cd webapp && pnpm test:e2e        # Playwright against E2E_BASE_URL (default: production)
cd firmware && pio test -e native && pio run -e crowpanel && pio run -e simulator
```

The pre-commit hook needs a working `python`/`python3`/`py`; without one it skips the bump and CI's version check catches it. PlatformIO (`pip install platformio`) provides `pio`.

## Versioning

Each tier has its own version, bumped automatically on commit for the tiers the staged diff touches. See `CLAUDE.md`.

## Hidden console

Tap the logo three times to open the debug console: tier versions and client/worker logs.
