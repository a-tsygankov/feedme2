# feedme2 — design spec

Date: 2026-09-20. Status: **draft for review**. Author: Claude (from Andrey's brief), based on a full read of `feedme`, `gigsy` and `howler`.

feedme2 is a ground-up rewrite of `feedme`: a cat-feeding tracker for one household, with a knob-driven ESP32 device, a PWA web app and a Cloudflare Worker backend. It borrows the *product* from feedme, the *web and worker stack* from gigsy, and the *device infrastructure* (OTA, pairing, Wi-Fi, versioning, HIL testing) from howler.

Section 0 lists every decision made on Andrey's behalf. Everything after it is written as if those decisions stand.

---

## 0. Decisions made on your behalf and open questions

Decisions (revert any of them and the rest of the spec adapts):

| # | Decision | Why |
|---|---|---|
| D1 | **House login = house name + PIN, plus QR login from a paired device.** No Google sign-in, no per-person users. | The brief says the House is the account and nobody in it is tracked. gigsy's Google flow needs a user identity we do not have. The session/refresh-token machinery is still gigsy's. |
| D2 | **Cat images are compiled into the firmware binary** (PNG bytes as C arrays, decoded by LVGL), not flashed to LittleFS. | The whole set is ~70 KB. Embedding means OTA updates images too and removes the separate `uploadfs` step. feedme dropped embedding when it was 870 KB of raw bitmaps; PNG embedding does not have that cost. |
| D3 | **Amounts are stored as integer milligrams** with the unit and value the person actually typed kept alongside. | gigsy rule: never REAL. Milligrams make 1/3 of a 5.5 oz can exact enough (51 974 mg) and keep reports unit-independent. |
| D4 | **Six hunger levels**, thresholds as fractions of a per-cat "hungry after" interval (default 5 h). | feedme had four quartiles; the brief asks for a longer arc ending in "almost dead". |
| D5 | **Two-tier sleep**: light sleep after 30 s idle (wakes on knob or touch), deep sleep after the house's sleep timeout (wakes on **touch only**, plus a timer for sync and OTA checks). | Encoder pins 41/42/45 are outside the ESP32-S3 RTC domain, so they cannot wake deep sleep. Touch INT is GPIO 5, which can. This matches "sleep until touched". See §5.5 for the hardware risk. |
| D6 | **Cloudflare Pages + Functions proxy** for the web app, exactly like gigsy, rather than Workers Static Assets. | "Same stack as gigsy". The CI, CSP middleware and preview-deploy flow port unchanged. |
| D7 | **Recharts** for charts (via shadcn/ui chart primitives). | gigsy has no charting library; shadcn's chart components are the least-new dependency on the same stack. |
| D8 | **Feedings can be edited and deleted in the web app** (amount, time, cat); the device only creates them. | Mis-taps on a knob are inevitable and reports are only useful if data can be corrected. |
| D9 | **Names**: worker `feedme2-api`, Pages `feedme2-webapp`, D1 `feedme2-db`, R2 `feedme2-firmware`, all under the account whose workers.dev subdomain is `atsyg-feedme`. | Same account as gigsy (`gigsy-api.atsyg-feedme.workers.dev`). The old `feedme` worker keeps running untouched. |
| D10 | **Logs from all three parts are persisted in D1** (7-day retention, per-house cap), not just in-memory ring buffers. | The brief asks for *complete* logging in the hidden console. gigsy's per-isolate ring buffer loses history on every isolate recycle. |
| D11 | **Battery support is designed in but gated on hardware**: firmware reads a battery ADC only when a build flag says a pack is fitted. | The CrowPanel board has no battery, charger or fuel gauge. Sleep design still targets battery use. |

Open questions (answers change scope, not architecture):

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | Will a LiPo actually be fitted to the CrowPanel MX1.25 connector? If so, which pin reads its voltage? feedme's handoff says `analogRead(1)`, but GPIO 1 is also the LCD 3V3 enable. | Build for USB power, keep `FEEDME_HAS_BATTERY=0`. |
| Q2 | Is the CST816D touch controller powered from the always-on 3V3 rail or from the GPIO 1-switched LCD rail? This decides whether touch can wake deep sleep at all. | Phase 0 spike measures it. Fallback is in §5.5. |
| Q3 | Two new silhouettes are needed that the feedme set lacks: a **collapsed / lying-flat** cat for "starving" and an **eating-from-bowl** cat for the feeding animation. Commission them, or accept C3 + red ring for starving and B3 for eating? | Ship with substitutes; add the two poses later as an asset-only release. |
| Q4 | Should feedings from the web app record *which phone* logged them (an opaque per-install id) for the history's "logged from" column? No person identity is implied. | Yes, as an opaque `client_id` per browser install. |
| Q5 | Can-size presets: only 5.5 oz, or also 3 oz and 12.5 oz? | Presets 3 / 5.5 / 12.5 oz plus custom grams. |

---

## 1. Product scope

### 1.1 Entities

- **House** — the account. Has a name, a PIN, settings (§1.4), one or more cats, zero or more devices.
- **Cat** — name, colour, avatar pose, "hungry after" interval, sort order. Max 8 per house (feedme capped at 4; the device carousel handles 8 comfortably).
- **Feeding** — one row per cat per feeding: time, amount (mg), what was entered (unit + value), source (`device` or `web`), device id when from a device, optional note. Client-generated UUID for idempotency. Editable and soft-deletable from the web app.
- **Device** — a paired CrowPanel: name, firmware version, last seen, battery (when known), revoked flag.

No people. "Who fed the cat" is intentionally out of scope.

### 1.2 What the device does

1. Sleeps. A touch wakes it to the **Idle** screen showing the selected cat's status image, colour ring, "fed 2 h ago", and its default amount.
2. Rotate → cycle cats (and "All cats" when there are two or more).
3. Press → **Amount** screen; rotate adjusts in the house's unit; press → feeding recorded, **Fed** animation, back to Idle.
4. Long-press from Idle → **System** round menu: Wi-Fi, Check for update, Login QR, Pair / Unpair, About, Sleep now.
5. Double-press → last 5 feedings overlay.
6. Syncs on wake, after each feeding, and on the timer wake. Queues feedings offline and drains them later.
7. Installs OTA updates the house approved in the web app, with hash verification and automatic rollback.

Everything else (naming, avatars, colours, units, sleep timeout, thresholds) is web-only. The device shows its Wi-Fi setup portal only when it has no credentials.

### 1.3 What the web app does

- **Dashboard** — one card per cat: status image, ring, time since last feeding, today's count and total, Feed button with an amount stepper pre-filled from the cat's last amount. Works offline for viewing and for queuing feedings.
- **Cat page** — history list with inline edit/delete, per-cat charts.
- **Reports** — house-wide and per-cat: feedings per day/week/month, amount totals in the house unit, cans consumed, mean interval, longest gap, time-of-day heatmap, drill-down month → week → day → individual feedings. CSV export.
- **Settings** — house name and PIN; units (g / oz / can fractions), can size, fraction step; default hungry-after; timezone; device sleep timeout; cats CRUD (name, colour, avatar); devices (rename, forget, pair by code, per-device OTA status); firmware releases (promote / yank / canary); sign out; delete house.
- **Setup / Login / QR login** — create a house, sign in with PIN, or land signed-in from a device QR.
- **Update bar** — the PWA detects a new build and offers reload (gigsy's `pwa-update.ts` verbatim).
- **Hidden console** — triple-tap the logo: versions of all four tiers, and a unified, filterable log view across web, worker and every device (§4.6).

### 1.4 House settings

| Setting | Values | Default | Consumed by |
|---|---|---|---|
| `food_unit` | `g`, `oz`, `can` | `g` | web + device display and input |
| `can_size_mg` | integer | 155 922 (5.5 oz) | conversions, "cans consumed" report |
| `can_fraction_step` | `1/4`, `1/3`, `1/2` | `1/4` | device knob step and web stepper when unit is `can` |
| `gram_step` | 1, 5, 10 | 5 | knob step when unit is `g` |
| `oz_step_hundredths` | 25, 50 | 25 (¼ oz) | knob step when unit is `oz` |
| `hungry_after_sec_default` | 1–24 h | 18 000 | new cats |
| `sleep_timeout_sec` | 60–3600 | 300 | device deep-sleep timer |
| `sync_interval_sec` | 1–24 h | 21 600 | device timer wake |
| `timezone` | IANA name | browser's | day boundaries in reports; offset pushed to device |

The device receives all of these in its state payload and never edits them.

### 1.5 Amount model

- Canonical value: `amount_mg` integer.
- Entry record: `entered_unit` (`g`/`oz`/`can`) and `entered_value` text (`"40"`, `"1.5"`, `"1/3"`), so history shows what was chosen, not a rounded conversion.
- Conversions live in **one shared TypeScript module** (`shared/src/units.ts`) and **one C++ header** (`firmware/src/domain/Units.h`) with a shared JSON vector file `fixtures/unit-vectors.json` asserted by both test suites (gigsy's drift-guard pattern).
- "Default for next feeding" = the cat's latest non-deleted feeding's `entered_unit`/`entered_value`, converted if the house unit changed since. Computed server-side into `cats.default_amount_mg` on every feeding write, so the device gets it for free in the state payload.

### 1.6 Hunger levels and images

`r = (now − last_fed_at) / hungry_after_sec`. Never fed counts as `r = ∞`.

| Level | Condition | Ring colour | Device / web image |
|---|---|---|---|
| `fed` | < 15 min since feeding | green, full | **C4** chunky-satisfied (or **B3** grooming for the first 3 s after logging) |
| `content` | r < 0.50 | green | the cat's **avatar pose** (its identity) |
| `peckish` | 0.50 ≤ r < 0.75 | yellow | **A2** standing, tail up, pacing |
| `hungry` | 0.75 ≤ r < 1.00 | orange | **B2** sitting, paw raised, begging |
| `very_hungry` | 1.00 ≤ r < 1.50 | red | **B4** hunched, reaching, pleading |
| `starving` | r ≥ 1.50 or never fed | red, pulsing | **C3** standing on hind legs, climbing you; replaced by a new lying-flat pose when it exists (Q3) |

Thresholds live in `shared/src/hunger.ts` and `firmware/src/domain/Hunger.h`, again with a shared vector file.

### 1.7 Cat image inventory (from `feedme/firmware/design/cats4/`)

All twelve are black-on-transparent silhouettes with a `-white` inverse; the white one is what the device tints with the cat's colour. Dimensions are the master PNG size (square).

| Slug | Master px | What it depicts | feedme2 role |
|---|---|---|---|
| A1 | 981 | Slim upright sit, front three-quarter, ears up | **avatar** |
| A2 | 1101 | Standing, tail straight up, head turned back | status **peckish** |
| A3 | 1147 | Low prowling walk, tail out | alternate for peckish; "searching" animation frame |
| A4 | 859 | Sitting seen from behind, head turned, tail curled | **avatar** (the aloof one) |
| B1 | 1307 | Three-quarter sit, calm | **avatar** (feedme's neutral) |
| B2 | 1537 | Sitting, one front paw raised | status **hungry** |
| B3 | 1005 | Head down, grooming | post-feeding animation, "fed" alternate |
| B4 | 1383 | Hunched forward, paw reaching, head up | status **very_hungry** |
| C1 | 1195 | Front-facing sit, tail wrapped | **avatar** |
| C2 | 1147 | Upright sit, head up and sideways | **avatar** (default) |
| C3 | 1529 | On hind legs, reaching up | status **starving** |
| C4 | 1161 | Round, heavy body, looking over shoulder | status **fed** |

Avatars offered in the web app: A1, A4, B1, C1, C2 (five calm poses). Colours: an 8-swatch palette (the four bold feedme colours plus four more) chosen to survive tinting on the dark device theme.

Missing and recommended (Q3): a lying-flat "starving" pose and an "eating from bowl" pose. Masters go in `assets/cats/` at the repo root; a script renders 130 px and 88 px white PNGs into `firmware/src/assets/cats/*.c` and 256 px black/white PNGs into `webapp/public/cats/`.

---

## 2. Repository layout

```
feedme2/
  package.json  pnpm-workspace.yaml  .npmrc (min-release-age=7)
  CLAUDE.md  README.md  handoff.md (one-page live state, howler style)
  backend/           Hono + Drizzle Worker (feedme2-api)
  webapp/            React 18 + Vite 5 + Tailwind + shadcn PWA (feedme2-webapp)
  shared/            TS-only: units, hunger, log schema, API zod types (workspace package)
  firmware/          PlatformIO: crowpanel / simulator / native envs
  assets/cats/       image masters + render script
  fixtures/          cross-language test vectors (units, hunger, api samples)
  tools/device-sim/  TS fake device for full-system e2e
  scripts/           deploy, setup-secrets, version_rules/bump/check (+ tests)
  docs/superpowers/{specs,plans}/
  .github/workflows/ deploy.yml  version-check.yml  firmware-release.yml
  .githooks/pre-commit
```

`shared/` is a pnpm workspace package imported by `backend`, `webapp` and `tools/device-sim`. It is TypeScript only; the C++ mirrors of `units` and `hunger` are kept honest by the fixture files.

---

## 3. Backend (Cloudflare Worker)

Stack: Hono 4, `@hono/zod-validator`, Drizzle ORM on D1, wrangler 4, vitest with `@cloudflare/vitest-pool-workers` (single-worker mode, as gigsy learned on Windows). Same conventions: TEXT UUID keys generated by clients, epoch-ms integers, `modified_at` on everything, every query scoped by `house_id` taken only from the auth middleware.

### 3.1 Schema (`backend/migrations/0000_init.sql`)

```
houses            id, name (unique, ci), pin_salt, pin_hash, food_unit, can_size_mg,
                  can_fraction_step, gram_step, oz_step_hundredths,
                  hungry_after_sec_default, sleep_timeout_sec, sync_interval_sec,
                  timezone, created_at, modified_at, deleted_at
cats              id, house_id, name, color, avatar_pose, hungry_after_sec, sort_order,
                  default_amount_mg, default_entered_unit, default_entered_value,
                  last_fed_at, created_at, modified_at, deleted_at
feedings          id, house_id, cat_id, fed_at, amount_mg, entered_unit, entered_value,
                  source, device_id, client_id, note, created_at, modified_at, deleted_at
                  idx (house_id, fed_at desc), (house_id, cat_id, fed_at desc)
devices           id (32-hex), house_id, name, hw_model, fw_version, last_seen_at,
                  battery_pct, reset_reason, auto_install, created_at, revoked_at
pending_pairings  device_id, pair_code, requested_at, expires_at, house_id,
                  confirmed_at, device_token, cancelled_at
login_qr_tokens   token, device_id, house_id, created_at, expires_at, consumed_at
refresh_tokens    id, house_id, token_hash, created_at, expires_at, rotated_from
firmware_releases version, sha256, sig, r2_key, size_bytes, notes, rollout_rules,
                  active, created_at, promoted_at, yanked_at
log_entries       id, house_id, source (web|worker|device), device_id, client_id,
                  ts, level, msg, data, created_at
                  idx (house_id, ts desc)
```

Cat `last_fed_at` and `default_*` are denormalised on feeding write inside one D1 batch so the device state call is a single indexed read.

### 3.2 Auth

- **House tokens** (web): 15-minute HS256 JWT access token + 30-day rotating opaque refresh token, hashed at rest — gigsy's `AuthManager` and `refresh_tokens` table, with `houseId` where gigsy had `userId`. Access token in memory only; refresh token in IndexedDB. Sign-in inputs: house name + PIN (PBKDF2-SHA256, 100k, from feedme), or a QR login token.
- **Device tokens**: 365-day HMAC token `{type:"device", houseId, deviceId, exp}` issued at pairing, Bearer only. Revoking a device sets `revoked_at`; middleware checks it.
- `requireHouse()`, `requireDevice()`, `requireEither()`; selector tokens are not needed (no users).
- `POST /api/auth/test-login` exists only when `ENVIRONMENT !== "production"`; e2e asserts it is enabled before running (gigsy's skip-is-a-trap guard).

### 3.3 Routes

Web (house token):
```
POST /api/auth/setup            {houseName, pin}           → tokens
POST /api/auth/login            {houseName, pin}           → tokens
POST /api/auth/refresh          {refreshToken}             → tokens (rotated)
POST /api/auth/logout
POST /api/auth/login-qr         {deviceId, token}          → tokens
GET  /api/auth/me
PATCH /api/auth/pin
GET|PATCH /api/house                                        settings
GET|POST /api/cats,  PATCH|DELETE /api/cats/:id
GET  /api/feedings?cat=&from=&to=&cursor=
POST /api/feedings              [{id, catId, fedAt, amountMg, enteredUnit, enteredValue, note}]
PATCH|DELETE /api/feedings/:id
GET  /api/reports/summary  daily  weekly  monthly  heatmap  export.csv   (?cat=&from=&to=)
GET  /api/devices, PATCH /api/devices/:id, DELETE /api/devices/:id
POST /api/pair/confirm          {pairCode}
GET|POST /api/firmware, PATCH /api/firmware/:version, GET /api/firmware/health
POST /api/logs                  [{ts, level, msg, data}]   (source=web, client_id)
GET  /api/debug/logs?source=&device=&level=&since=&limit=
```

Device (device token unless noted):
```
POST /api/pair/start            (none) {deviceId, hwModel, fwVersion} → {pairCode, expiresAt}
POST /api/pair/check            (none) {deviceId} → {status, deviceToken?, houseId?}
GET  /api/device/state          → {house{...settings, tzOffsetMin}, cats[...], now,
                                    syncIntervalSec, sleepTimeoutSec, update{...}?}
POST /api/device/feedings       [{id, catId, fedAt, amountMg, enteredUnit, enteredValue}] → {accepted[], now}
POST /api/device/heartbeat      {fwVersion, batteryPct?, uptimeSec, resetReason, freeHeap}
POST /api/device/logs           [{ts, level, msg, data}]
GET  /api/firmware/check?fwVersion=
POST /api/auth/login-token-create → {token, expiresInSec}
```

Public: `GET /api/version` (webapp, worker, schema, latest firmware), `GET /api/health`.

`/api/device/state` is the only device read; it carries everything the device needs including the OTA advisory, so a wake costs one round trip when nothing changed. The response carries an `ETag`; the device sends `If-None-Match` and gets 304.

### 3.4 Cron

Every hour: prune `log_entries` older than 7 days and beyond 5 000 rows per house; prune expired pairings and QR tokens; expire refresh tokens.

### 3.5 OTA (ported from howler)

`firmware_releases` + R2 `feedme2-firmware` + SigV4 presigned 5-minute download URLs minted with `crypto.subtle`. Releases land `active=0`; promotion is manual in the web app. Rollout rules: `deviceIds[]` or `canaryPercent`, fail-closed. Signature: RSA-3072 detached signature over the binary, public key embedded at build time (howler's `embed-pubkey.py`/`sign-firmware.sh`).

---

## 4. Web app

Stack, verbatim from gigsy: React 18, Vite 5, TypeScript, react-router-dom 6, Tailwind 3 with the `R G B` token layer and `data-theme` dark mode, shadcn/ui new-york, TanStack Query 5, `useSyncExternalStore` stores, Dexie for the offline outbox, `vite-plugin-pwa` in `injectManifest` mode with the hand-written `sw.ts`, `theme-boot.js` as a file for CSP, driver.js tours for help, Playwright on the Pixel 7 profile, vitest + jsdom.

### 4.1 Routes

```
/                dashboard
/cats/:id        cat detail + history + charts
/reports         house reports, drill-down via ?range=&cat=&from=
/settings        tabs: house · units · cats · devices · firmware · about
/setup /login    house creation and PIN login
/qr              ?deviceId=&token= auto-login landing
```

### 4.2 Offline

Read model cached by TanStack Query with `networkMode: "always"` and persisted to IndexedDB. Writes: feedings and feeding edits go through a Dexie outbox keyed by feeding id (one pending op per row), drained by a small sync engine (gigsy's, minus images). Settings and cat edits are online-only and say so.

### 4.3 Dashboard UX

- Cards in `sort_order`; each shows the status image tinted with the cat colour, the ring, "2 h 10 m ago", today's count and total.
- **Feed** opens a bottom sheet: amount stepper in the house unit (fractions shown as `¼ ½ ¾ 1` chips when unit is `can`), time defaulting to now with a "5 min ago / 15 / 30 / custom" row, optional note. One tap on the card's primary button logs the default amount without the sheet.
- "Feed all" appears only when there are two or more cats (feedme's "never show a selector with one option" rule is kept everywhere).

### 4.4 Reports UX

Range picker (day / week / month / custom), cat filter, unit toggle (house unit or cans). Panels: feedings-per-period bar chart, amount-per-period stacked by cat, interval distribution, hour-of-day heatmap, table with drill-down. Charts follow the `dataviz` skill palette rules and are built once as a `<FeedingChart kind=…>` family.

### 4.5 PWA update prompt

gigsy's `pwa-update.ts`, `pwa-update-browser.ts` and `UpdateBar.tsx` unchanged: `registerType: "prompt"`, `registration.update()` on `visibilitychange`, reload only the tab that asked. In addition the app polls `/api/version` every 10 minutes while visible and shows the bar when the served webapp version is newer than the running one, which covers browsers that throttle service-worker update checks.

### 4.6 Hidden console (triple-tap the logo)

Ported from gigsy (`multi-tap.ts`, `HiddenConsole.tsx`, `LogList.tsx`) and extended:

- **Versions**: webapp, worker, schema, and firmware version per paired device with last-seen.
- **Logs**: one list merging three sources with a common shape `{ts, level, source, deviceId?, clientId?, msg, data}`. Filters: source (web / worker / device name), level, text, time window. "Live" toggle polls `/api/debug/logs` every 5 s. "Copy" and "Download JSON" buttons.
- Web logs are the local ring buffer merged with the server copy, deduplicated by `(clientId, ts, msg)`.
- Uncaught errors and unhandled rejections are captured (gigsy's `installGlobalErrorCapture`).

Log pipeline per source:

| Source | Local buffer | Upload |
|---|---|---|
| web | 200-entry ring | batches of ≤50 every 30 s while visible; errors flush immediately; `POST /api/logs` |
| worker | 200-entry per-isolate ring (kept for pre-login debugging) | every entry written to `log_entries` via `ctx.waitUntil` in one batched insert per request |
| device | 128-entry ring in PSRAM, level-tagged; `Serial` mirror | drained on every sync and before deep sleep; errors force a flush; `POST /api/device/logs` |

Retention: 7 days or 5 000 rows per house. Log `data` is JSON, capped at 1 KB per entry at the boundary.

---

## 5. Firmware

Board: **Elecrow CrowPanel 1.28" HMI ESP32 Rotary Display** — ESP32-S3R8V, 16 MB flash, 8 MB OPI PSRAM, GC9A01 240×240 round IPS on SPI (MOSI 11, SCLK 10, CS 9, DC 3, RST 14, BL 46), CST816D touch on I²C (SDA 6, SCL 7, INT 5, RST 13), encoder A 45 / B 42 / switch 41, 5× WS2812 on 48, LCD rail enable GPIO 1, LED-ring rail enable GPIO 2. Pin map and TFT_eSPI flags are inherited verbatim from howler's `platformio.ini`.

Stack: PlatformIO, Arduino-ESP32 (espressif32 6.9), TFT_eSPI 2.5, **LVGL 9.0.0** (howler's pinned version with the SIMD-strip script), ArduinoJson 7, NeoPixel. Partition table: howler's dual-app `default_16MB.csv` (two 4 MB OTA slots). LittleFS is kept only for the offline feeding queue and log spill.

### 5.1 Architecture

Ports-and-adapters, host-testable, same shape as howler:

```
domain/        Hunger.h Units.h Version.h RotaryNav.h Router.h FeedFlow.h CatRoster.h  (pure, no Arduino)
application/   App  FeedingService  SyncService  OtaService  PairCoordinator  PowerManager  LogService
ports/         IClock IDisplay INetwork IStorage IInput IPower IOta ILog
adapters/      WifiNetwork WifiCaptivePortal WifiStation NvsStorage LittleFsQueue
               Cst816Touch RotaryInput CompositeInput LedRing EspOtaAdapter EspPower
               + Noop*/Stub* doubles
screens/       ScreenManager + one screen_*.cpp per screen; components/RoundMenu, LongPressArcWidget, CatImage
assets/        cats/*.c (generated), fonts
```

### 5.2 Screens and knob grammar

Input contract (howler's): `Press` activate · `DoubleTap` back · `LongPress` (600 ms, perimeter arc) confirm / up one level · `RotateCW/CCW` move selection · touch tap = Press, horizontal swipe = rotate. Touch is otherwise unused; there is no on-screen keyboard.

| Screen | Rotate | Press | Long-press | Double |
|---|---|---|---|---|
| Boot | — | — | — | — |
| Pair (QR + 6-digit code) | — | retry | — | — |
| Idle | cycle cat / All | Amount | System menu | History overlay |
| Amount | ± step in house unit | **log feeding** | cancel | — |
| Fed (2 s, B3 → C4) | — | skip | — | — |
| History overlay (5 rows) | scroll | dismiss | — | — |
| System (round menu) | select | open | back | — |
| Wi-Fi list | select SSID | connect / open portal | back | — |
| Update | — | Update now / Check again | back | — |
| Login QR (60 s) | — | regenerate | back | — |
| About | — | — | back | — |
| Unpair confirm | — | — | **confirm** | — |

"All cats" logs one feeding per cat with each cat's own default amount; the Amount screen then shows a scaling factor (½ ×, 1 ×, 1½ ×) instead of an absolute value.

### 5.3 Sync

`SyncService` runs one round on: wake from any sleep, after each feeding, pairing confirmed, and the timer wake. A round = drain feeding queue → drain log queue → `GET /api/device/state` with `If-None-Match` → apply → heartbeat. State is cached in NVS so the Idle screen renders before Wi-Fi associates (< 300 ms from touch to picture is the target; Wi-Fi joins in the background and the ring updates when state arrives).

Time: RTC keeps counting through deep sleep; SNTP re-syncs after each association; the server's `now` corrects drift.

### 5.4 OTA

howler's `OtaService` state machine, `EspOtaAdapter` with streamed SHA-256 over the inactive slot before commit, and rollback: the new build marks itself valid only after its first successful sync round. The Update screen auto-checks on entry. The house approves updates in the web app; the device also auto-installs on the timer wake when `auto_install` is set for that device (off by default).

### 5.5 Power

| Tier | Trigger | State | Wakes on |
|---|---|---|---|
| Awake | any input | backlight on, Wi-Fi on | — |
| Dim | 15 s idle | backlight 30 % | any input |
| Light sleep | 30 s idle | GC9A01 sleep-in, backlight off, LED off, Wi-Fi modem sleep, CPU light sleep | encoder switch 41, encoder A 45, touch INT 5 (any GPIO works in light sleep) |
| Deep sleep | `sleep_timeout_sec` idle | everything off; LCD rail GPIO 1 held (see risk) | touch INT 5 via `ext0` (RTC GPIO), RTC timer at `sync_interval_sec` |

Light sleep keeps the Wi-Fi association and RAM, so a knob press resumes in < 100 ms. Deep sleep is where the battery win lives; the wake cost is a full boot (~1.2 s to Idle from cached state).

Hardware risk (Q2): if the CST816D is powered from the GPIO 1-switched rail, deep sleep must keep GPIO 1 high with `gpio_hold_en`, after putting the GC9A01 into sleep-in (0x10, ~µA). If the touch INT cannot wake at all, deep sleep falls back to timer-only and light sleep becomes the resting state. The Phase 0 spike settles this on the bench and the `PowerManager` port hides the choice from everything else.

### 5.6 Wi-Fi

howler's flow unchanged: no credentials → raw-TFT "Wi-Fi setup" splash + captive portal (`feedme2-XXXX` SoftAP, scan-before-AP, dropdown + free-text SSID, brownout detector muted during the portal) → reboot. Paired devices can re-pick an open network from the on-device list; secured networks route to the portal. Credentials in NVS `feedme2.wifi`, plaintext (no secure element).

### 5.7 Testing without a person

1. **HIL-1, native**: Unity tests over `domain/` and `application/` with the `Stub*` ports. Target ≥ 150 tests: hunger arc, unit stepping, feed flow (single / all / cancel), sync round ordering, queue drain and re-queue, OTA state machine and downgrade guard, power tier transitions with a fake clock. Runs on every PR in seconds.
2. **HIL-2, Wokwi**: `[env:simulator]` (ILI9341 stand-in, `qio_qspi`, merged bin). `diagram.json` adds a `wokwi-ky-040` encoder and a push button on 45/42/41. `wokwi-cli` **scenario files** drive the knob and button and assert serial lines (`[feedme2] idle cat=Mochi level=content`, `[feedme2] feeding queued id=…`). Firmware prints a machine-readable event line for every screen transition under `-DSIMULATOR=1`. Runs in CI when `WOKWI_CLI_TOKEN` is present. Whether Wokwi's KY-040 part accepts scripted rotation is verified in Phase 0; the fallback is a serial command channel (`-DSIMULATOR=1` only) that injects input events.
3. **Device simulator (TS)**: `tools/device-sim` speaks the device API exactly (pair, state, feedings, logs, heartbeat, firmware check) using the shared zod types. Full-system e2e pairs a simulated device, logs feedings from it and from the web app, and asserts the dashboard, reports and hidden console show all of it.
4. **Contract vectors**: `fixtures/*.json` asserted by vitest and by Unity so the C++ and TS copies of units and hunger cannot drift.
5. **HIL-3, real hardware**: optional self-hosted runner flashing a bench unit nightly; out of scope for the first release, port later from howler's plan.

---

## 6. Infrastructure, versioning, CI

### 6.1 Versioning tiers

| Tier | Source | Bumped when |
|---|---|---|
| webapp | `webapp/package.json` | non-doc change under `webapp/` or `shared/` |
| worker | `backend/package.json` | non-doc change under `backend/` (excluding `migrations/`) or `shared/` |
| schema | new file in `backend/migrations/` | any schema change (edit-in-place rejected) |
| firmware | `firmware/src/application/Version.h` `kFirmwareVersion` | non-doc change under `firmware/` or `fixtures/` |

`scripts/version_rules.py`, `bump_versions.py` (pre-commit auto-bump, gigsy's index-safe implementation extended with a regex rule for `Version.h`) and `check_version_bump.py` (CI gate) with their unittest suites. `shared/` touches bump both webapp and worker. `/api/version` reports all four; the hidden console shows them.

### 6.2 Workflows

- **`deploy.yml`**: `dorny/paths-filter` on `backend`, `webapp`, `firmware`, `shared`. Jobs: backend test → migrate remote → wrangler deploy; webapp typecheck + unit tests + build → PR preview deploy + preview smoke e2e + **full e2e** against local `wrangler dev` with the watchdog loop from gigsy and the device simulator → main deploy; offline-shell e2e on the production build; firmware native tests + `pio run -e crowpanel` + `pio run -e simulator` → Wokwi scenario job.
- **`version-check.yml`**: PR gate.
- **`firmware-release.yml`**: on `release/v*` or dispatch: build, sign, sha256, upload to R2, register `active=0`. Promotion is a click in the web app.

### 6.3 Scripts

`deploy.ps1` / `deploy.sh` (`-Backend -Webapp -Firmware -All`), `setup-secrets.ps1` (gigsy's: `-Provision` creates D1 and R2, `-GitHub` runs `gh secret set`, `-Cloudflare` pipes into `wrangler secret put`, `GENERATE` placeholders, real copy is `setup-secrets.local.ps1`), `firmware/scripts/{generate-signing-key.sh, sign-firmware.sh, embed-pubkey.py, register-firmware.sh, strip_lvgl_simd.py, merge_simulator_bin.py}`, `assets/cats/render.py`.

### 6.4 Secrets and vars

GitHub: `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` (same values as the gigsy repo), `WOKWI_CLI_TOKEN`, `OTA_SIGNING_KEY`, `OTA_ADMIN_HOUSE_TOKEN`. Worker secrets: `AUTH_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Vars: `ENVIRONMENT`. Pages var: `WORKER_ORIGIN`. Local: `backend/.dev.vars` from `.dev.vars.example`.

### 6.5 Cloudflare resources

Under the account with workers.dev subdomain `atsyg-feedme`: Worker `feedme2-api`, Pages `feedme2-webapp` (previews per branch), D1 `feedme2-db`, R2 `feedme2-firmware`. No queues, no Durable Objects, one cron. The old `feedme` worker, D1 and Pages project are left alone; there is no data migration (the brief is a rewrite, and feedme never stored amounts).

---

## 7. Phases

Each phase is its own plan and PR series; each ends with green CI and a deployable state.

| Phase | Deliverable | Exit test |
|---|---|---|
| **0 Foundation** | Monorepo, pnpm, `shared/`, CLAUDE.md, versioning scripts + hook + CI gate, deploy workflow skeleton, secrets script, D1/R2 provisioned, `/api/version` live, PWA shell deployed with update bar, hidden console showing versions. **Bench spike**: touch-wake from deep sleep and the GPIO 1 rail question (Q2); Wokwi encoder scripting (§5.7). | CI green; `feedme2-webapp.pages.dev` shows versions; spike report in `docs/`. |
| **1 Core data + web** | Schema, house auth, cats, feedings, units module, dashboard with Feed sheet, settings (house, units, cats), offline outbox, unified logging + console logs tab. | Full e2e: create house → add 2 cats → feed from web → edit → console shows web + worker logs. |
| **2 Device MVP** | Firmware skeleton, Wi-Fi portal, pairing, state sync, Idle/Amount/Fed screens, embedded images, feeding queue, heartbeat, device logs, light sleep. Device simulator + Wokwi scenarios. | System e2e with device-sim; Wokwi scenario logs a feeding; native tests ≥ 100. |
| **3 Power + OTA** | Deep sleep tiers, timer wake, OTA service + release workflow + web firmware page, rollback. | Wokwi/bench: update 0.2.x → 0.3.0 and rollback on a build that fails to sync. |
| **4 Reports** | Reports page, charts, drill-down, CSV, cat page charts, cans-consumed. | e2e over a seeded month of feedings; snapshot tests for aggregations. |
| **5 Polish** | Login QR wired end to end, device rename/forget, canary rollouts, help tours, new cat poses if delivered, HIL-3 plan. | Release `1.0.0` across all tiers. |

---

## 8. Things deliberately left out

- People / "who fed" tracking, feeder picker, user colours.
- Meal schedules, quiet hours, snooze ("just begging") — feedme features not in the brief. Reports cover the analysis those tried to provide.
- Push notifications. (Worth a follow-up once a house has been running for a while.)
- Automatic feeder hardware (hopper). This is a tracker.
- Data migration from feedme.
- MQTT; REST behind `INetwork` is enough at this scale.
