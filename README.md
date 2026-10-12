# feedme2

Household cat-feeding tracker: a knob-driven ESP32 dial (Elecrow CrowPanel 1.28"), a PWA, and a Cloudflare Worker. Design: `docs/superpowers/specs/2026-09-20-feedme2-design.md`.

## Layout

| Dir | What | Deploys to |
|---|---|---|
| `shared/` | zod schemas, ring buffer, version compare (TS only) | bundled into both |
| `backend/` | Hono Worker + D1 | `feedme2-api.atsyg-feedme.workers.dev` |
| `webapp/` | React 18 + Vite PWA | `feedme2-webapp.pages.dev` |
| `firmware/` | PlatformIO / LVGL 9 for CrowPanel | flashed over USB, later OTA |
| `tools/device-sim/` | TypeScript fake CrowPanel: speaks `/api/pair/*` and `/api/device/*`; the system e2e imports it, the CLI drives it by hand | not deployed |
| `fixtures/` | cross-tier test vectors (amount units, hunger levels) and `device-state.sample.json` (the `GET /api/device/state` shape): pinned by the shared tests, to be read by the firmware port | not deployed |

## Getting started

```bash
pnpm install                      # also installs the pre-commit version-bump hook
cp backend/.dev.vars.example backend/.dev.vars
pnpm db:migrate:local
pnpm dev:backend                  # wrangler dev on :8787
pnpm dev:webapp                   # vite on :5173, proxies /api to :8787
pnpm test                         # shared + backend + webapp + device-sim unit tests
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

### Simulate a device

No hardware needed: with `pnpm dev:backend` running and a house set up,

```bash
pnpm --filter @feedme2/device-sim start pair --api http://127.0.0.1:8787   # prints a 6-digit code and waits
# type the code in Settings -> Devices (or open /settings?pair=<code>#devices), then:
pnpm --filter @feedme2/device-sim start feed Mochi 40000                  # queue a feeding (mg)
pnpm --filter @feedme2/device-sim start sync                              # send feedings and logs, fetch state, heartbeat
```

The fake device keeps its token and queues in `tools/device-sim/device-sim.json`; see `tools/device-sim/README.md` for every command and the exit codes.

The pre-commit hook needs a working `python`/`python3`/`py`; without one it skips the bump and CI's version check catches it. PlatformIO (`pip install platformio`) provides `pio`.

## Versioning

Each tier has its own version, bumped automatically on commit for the tiers the staged diff touches. See `CLAUDE.md`.

## Hidden console

Tap the logo three times to open the debug console: tier versions and the merged client, worker and device logs (filters including a minimum level, live mode, copy and download). It reads `/api/debug/logs`, scoped to the signed-in house.
