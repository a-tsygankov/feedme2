# feedme2

Household cat-feeding tracker: a knob-driven ESP32 dial (Elecrow CrowPanel 1.28"), a PWA, and a Cloudflare Worker. Design: `docs/superpowers/specs/2026-09-20-feedme2-design.md`.

## Layout

| Dir | What | Deploys to |
|---|---|---|
| `shared/` | zod schemas, units and hunger rules, house-zone calendar math, report aggregation, CSV, ring buffer, version compare (TS only) | bundled into both |
| `backend/` | Hono Worker + D1 | `feedme2-api.atsyg-feedme.workers.dev` |
| `webapp/` | React 18 + Vite PWA | `feedme2-webapp.pages.dev` |
| `firmware/` | PlatformIO / LVGL 9 for CrowPanel: `src/{domain,ports,application,adapters,screens,assets}` | flashed over USB (`pio run -e crowpanel -t upload`), later OTA |
| `tools/device-sim/` | TypeScript fake CrowPanel: speaks `/api/pair/*`, `/api/device/*` and QR login (`/api/auth/login-token-create`); the system e2e imports it, the CLI drives it by hand | not deployed |
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
pnpm --filter @feedme2/device-sim start login-qr --web http://127.0.0.1:5173   # a one-time sign-in URL for a second phone (60 s)
```

The fake device keeps its token and queues in `tools/device-sim/device-sim.json`; see `tools/device-sim/README.md` for every command and the exit codes.

The pre-commit hook needs a working `python`/`python3`/`py`; without one it skips the bump and CI's version check catches it. PlatformIO (`pip install platformio`) provides `pio`.

## Reports

`/reports` (the Reports tab) answers "how much, how often, when" for a day, a Monday-to-Sunday week, a calendar month or a custom range, house-wide or for one cat (the cat filter hides when the house has one cat; a removed cat's feedings still count, labelled "Name (removed)"):

- tiles: feedings, amount (in the house unit, or cans with the unit toggle), cans, mean interval and longest gap between two feedings of the same cat;
- charts: feedings and amount per period stacked by cat in each cat's colour, a histogram of the time between feedings, and a weekday × hour heatmap; every chart has a data-table fallback for screen readers;
- drill-down: month → week → day → that day's feedings, by tapping a bar or a table row; Back walks up one level, and the arrows shift the range;
- **Download CSV**: one row per feeding (`date,time,cat,amount,unit,grams,entered_value,entered_unit,source,note`), in the house zone and unit, UTF-8 with a BOM for Excel; cells that a spreadsheet would run as a formula get a leading `'`.

Every bound, bucket and label is in the **house's** time zone (Settings → timezone), never the phone's: a phone in Tokyo looking at a Berlin house sees Berlin days, and a DST day is still one day (23 or 25 hours). Weeks start on Monday for every house. Cans use the house's current can size for the whole range. The filters live in the URL (`range`, `from`, `to`, `cat`, `unit`), so a report is a shareable link; a bad link falls back to this week.

Limits: dates must lie in 2000-01-01..2999-12-31 and a range covers at most 732 days (a longer pasted link is cut to its first 732 days); a one-day range charts by hour, up to 92 days by day, up to 400 by week, beyond that by month (the API takes hour buckets for at most 7 days); a day's feeding list shows its latest 200 feedings. Reports are online-only: offline, the last loaded report stays on screen, and with nothing cached the page says "Reports need a connection". The cat page (`/cats/:id`) shows the same numbers for the cat's last 30 days, with a link that opens them in Reports.

The API behind it is `GET /api/reports/summary` and `GET /api/reports/export.csv` (see `handoff.md`); the aggregation is `aggregateReport` in `shared/src/reports.ts`, the same code the tests snapshot over a seeded March 2026.

## QR login

A paired device can sign a phone into its house without the PIN (spec §1.3, §5.2 "Login QR (60 s)"). The device asks the Worker for a one-time code (`POST /api/auth/login-token-create`, device token) and shows it as a QR of `https://feedme2-webapp.pages.dev/qr#deviceId=…&token=…`. The phone that opens it posts the code to `POST /api/auth/login-qr` and lands on the dashboard of the device's house, signed in like a PIN login.

- A code lives **60 seconds** and works **once**: two phones scanning the same QR get one sign-in and one "This sign-in code has expired or was already used", with a link to PIN sign-in.
- A device has **one live code**: asking for a new one kills the previous QR. Forgetting or re-pairing the device kills its codes too, even a re-pair to the same house.
- The code rides in the URL **fragment**, which no server log or `Referer` header sees, and `/qr` replaces the address with a bare `/qr` before it exchanges the code, so a failed or abandoned sign-in leaves nothing live in the history. A success then goes to `/`. Links in the older query form (`/qr?deviceId=…&token=…`) still work.
- A phone **already signed in to another house** is asked first ("You're signed in to X. Sign in to the device's house instead?"); Stay keeps the current house and does not spend the code, Switch signs in to the device's house and clears the old house's cached data.
- Offline, `/qr` says "No connection" and offers Retry while the code is still within its minute.

The Worker stores only the SHA-256 of each code (`login_qr_tokens`, migration `0003`), answers every refused code with the same 401, and the hourly cron deletes codes about an hour after they expire. The device's Login QR screen waits for the firmware pause to end; until then `tools/device-sim` stands in (`login-qr`, above).

## Help

Tap the **?** in the header (on every signed-in screen) to open the help sheet: a search box and eight topics in six sections (Getting started, Cats and feeding, Reports, Devices, Settings, Install the app). Picking a topic closes the sheet, goes to the screen it starts on and runs a guided tour over the real controls (driver.js 1.8.0, loaded only when a tour starts). Tours point and explain; they never type, feed, save or pair for you, and the only taps they ask for are harmless (open Reports, open the cat editor). A tour adapts to the house: one cat or several, grams, ounces or cans, a report loaded or offline. If a control it needs never appears, it stops with "This help step is currently unavailable" and Back to Help. "Install feedme2" is instructions only, per browser and platform. Escape, Close, a tap outside the sheet or the **?** again closes help.

Every executable topic also runs end to end in CI (the `help` Playwright project, on pull requests, against the local stack), so a renamed test id cannot leave a tour pointing at nothing. Locally, with the full local stack from Getting started running:

```bash
pnpm --filter ./webapp help:validate          # the help unit suite (vitest run src/help, ~20 s: one file drives the real driver.js)
cd webapp && E2E_BASE_URL=http://127.0.0.1:5173 E2E_REQUIRE_AUTH=1 pnpm help:test   # every topic, end to end
```

`help:test` refuses any target but localhost: it signs in to fresh test houses and seeds them. Adding a topic: `docs/help/README.md`.

## Firmware

`firmware/src` is ports-and-adapters (spec §5.1): `domain/` (units, hunger, clock model, cat roster, feed flow, queue, router — pure C++17), `ports/` (the interfaces), `application/` (log, feeding, pairing, sync and power services plus `App`, which owns the knob grammar), `adapters/` (ESP32: NVS, LittleFS queues, knob, touch, Wi-Fi station and captive portal, HTTPS client, power and LED ring; `FakeNetwork` and `SimulatedClock` for the simulator), `screens/` (LVGL 9 over TFT_eSPI) and `assets/cats/` (silhouette PNGs as C arrays, generated by `assets/cats/render.py`). `domain/` and `application/` have no Arduino headers and are the only code the host tests compile.

```bash
cd firmware
pio test -e native                 # Unity over domain/ + application/, pinned by ../fixtures/*.json (142 cases)
pio run -e crowpanel               # hardware build (GC9A01); add -t upload to flash over USB, then pio device monitor
pio run -e simulator               # Wokwi build (ILI9341 stand-in, -DSIMULATOR=1, merged bin + diagram.json)
```

Envs: `crowpanel` (hardware), `simulator` (Wokwi), `native` (host tests), `spike-sleep` (the Phase 0 bench spike only).

The simulator has no network and no knob: `FakeNetwork` answers the device API from `fixtures/device-state.sample.json` (pair code `424242`), and input comes from a **serial command channel**: one of `press`, `double`, `long`, `cw`, `ccw`, `touch` per line. Every screen transition and sync outcome prints one machine-readable line, `[feedme2] <event> key=value …` (for example `[feedme2] idle cat=Mochi level=content`, `[feedme2] sync ok accepted=1 state=changed`). The scenarios in `firmware/wokwi/*.scenario.yaml` (`boot`, `pair`, `feed`, `feed_all`, `system_menu`) write those commands and wait for those lines; CI runs them with `wokwi-cli` when `WOKWI_CLI_TOKEN` is set and skips otherwise. Locally: `wokwi-cli --scenario wokwi/feed.scenario.yaml --timeout 90000 firmware`. The full list of event lines is in `docs/handoffs/2026-10-12-phase2b-execution-handoff.md`; they are a contract, so renaming one means updating the scenarios.

On hardware the captive portal (`feedme2-XXXX`) opens by itself only on an unpaired device with no saved Wi-Fi credentials, and restarts the device after 10 minutes with nobody on it. To change the network later, press on System → Wi-Fi; an unpaired device whose saved password is wrong gets the portal by holding the knob button down while it boots. Once online, an unpaired device shows a QR and a six-digit code to type under Settings → Devices. Sync makes one HTTPS request per loop tick (one TLS connection each), so the screen and the knob stay live during a round; light sleep drops the Wi-Fi association, so the station rejoins after every nap and a requested round keeps the device awake up to 15 s for it. Only the backend's own 401 unpairs the device; the menu Unpair and that 401 both clear the cached house.

## Versioning

Each tier has its own version, bumped automatically on commit for the tiers the staged diff touches. See `CLAUDE.md`.

## Hidden console

Tap the logo three times to open the debug console: tier versions and the merged client, worker and device logs (filters including a minimum level, live mode, copy and download). It reads `/api/debug/logs`, scoped to the signed-in house.
