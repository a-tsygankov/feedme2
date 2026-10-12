# Phase 2b execution handoff — 2026-10-12

Branch `feat/phase2b-firmware-mvp`, stacked on `feat/phase2a-device-api` (PR #2, CI green, merge left to Andrey): 24 firmware commits from `dbd7932` to `5a85acb` plus this docs commit, not pushed, no PR yet. Plan: `docs/superpowers/plans/2026-10-11-phase2b-firmware-mvp.md` (Tasks 1–16 and Task 17 Step 1 ticked; Steps 2–3, full verification and the PR, are the dispatcher's). Spec: `docs/superpowers/specs/2026-09-20-feedme2-design.md` §1.2, §1.5–1.7, §5, §6.1–6.2, §7 row "2 Device MVP". Device API: the Phase 2a handoff. Live state: `handoff.md`.

## What was built

One line per plan task; the SHA is the feature commit, the fix commits after it.

| Task | What | Commits |
|---|---|---|
| 1 | Native env builds `domain/` + `application/` with ArduinoJson; `InputEvent` enum; `lv_conf.h` gains PNG (lodepng), QR code, the Montserrat sizes and `LV_CACHE_DEF_SIZE 0` | `dbd7932` |
| 2 | `domain/Units.h` pinned by `fixtures/unit-vectors.json` through `test/fixtures.h` | `7b614f2` |
| 3 | `domain/Hunger.h` pinned by `fixtures/hunger-vectors.json`; `ClockModel` (monotonic + server offset, unsynced until a server `now`) | `c5ed6cb`; 49.7-day wrap fix `bc8c1d0` |
| 4 | `DeviceState`, `CatRoster` (cats + "All"), `FeedFlow` (single / all, scale factors, 40 g fallback), `FeedingQueue` (cap 200), `Router`, `LongPressArc` | `512ea4d`; snap-before-clamp and snapped defaults `bc8c1d0` |
| 5 | Ports (`IClock IInput INetwork IStorage IFileQueue IPower ILogSink IRandom`), test doubles, `StateCodec` / `QueueCodec` (ArduinoJson) | `e6a9f16` |
| 6 | `LogService` (300-line ring mirrored to `/logs.jsonl`, lazy compaction, `[feedme2]` event lines) and `FeedingService` (persisted `/feedings.jsonl`, 5 recent) | `7a0fb65`; compaction, idle `takeBatch` and UTF-8 clamp tests `220c8da` |
| 7 | `PairCoordinator`: fresh `pollSecret` per start, code polling, expiry restart, token in NVS | `2acf18e`; bad-body warn and nits `85724ec` |
| 8 | `SyncService`: feedings → logs → state (ETag) → heartbeat in one round; `RoundResult`; 401 handling | `b6d5062`; non-JSON 2xx, 60 s retry, 401 clears cached state `4027137` |
| 9 | `PowerManager`: Awake → Dim (15 s) → LightSleep (30 s), swallowed wake event, timer wake | `7b7af0c`; sleep-out before backlight, stuck-hold timeout `85724ec` |
| 10 | `App`: screen routing, the knob grammar of §5.2, sync and power glue, `[feedme2]` screen / idle / amount / fed lines | `bfb1362`; screen line before the round it triggers, UI generation tracks hunger time `7d67ac8` |
| 11 | ESP32 adapters: `ArduinoClock`, `EspRandom`, `NvsStorage`, `LittleFsQueue`, `RotaryInput`, `Cst816Touch`, `CompositeInput`, `EspPower` + `LedRing`, `SerialLogSink` | `65623a1`; atomic appends, LED rail off at zero, shared wake pins, quiet NVS first boot `44f97fc` |
| 12 | `WifiStation` (NVS `wifi` blob, SNTP, `ensureConnected`), `WifiCaptivePortal` (howler's flow), `WifiNetwork` (HTTPS, `setInsecure`); simulator `FakeNetwork` (seeded by `scripts/embed_fixture.py` → `FakeState.h`) and `SimulatedClock` | `085c7f5`; portal logs the SSID length, sim speed pinned, fake-server caveats `7f0a306` |
| 13 | Cat silhouettes as PNG C arrays, 130 px (Idle) and 88 px (Fed), `assets/cats/render.py` → `firmware/scripts/png_to_c.py`, `CatAssets.h` | `3104212` |
| 14 | LVGL screens (pair with QR, idle with hunger ring, amount, fed, history, system, wifi, about, unpair) and `main.cpp` for crowpanel and simulator | `944eedc` |
| 15 | Wokwi scenarios `boot`, `pair`, `feed`, `feed_all`, `system_menu`; `firmware-hil2` matrix in CI | `8fc6922` |
| 16 | Native test audit: **132** Unity cases (`pio test -e native`) | `5a85acb` |
| 17 | This handoff, `handoff.md`, README, CLAUDE.md, spike note, plan ticks | the docs commit that added this file |

Binary sizes after Task 12 (before the screens landed): crowpanel 555 725 B, simulator 560 005 B. The PR body should quote the current `pio run` output.

## How it was verified

Every task ran `pio test -e native` and, for anything under `adapters/`, `screens/` or `main.cpp`, `pio run -e crowpanel && pio run -e simulator`. The native summary at Task 16 reads `132 test cases: 132 succeeded`. Each task was reviewed by a separate agent before the next one started; the must-fixes were applied in fix batches (Task 6: `220c8da`; Task 8: `4027137`; Task 10 ordering: `7d67ac8`; adapters: `44f97fc`, `7f0a306`; domain nits: `bc8c1d0`; application nits: `85724ec`). The Task 14 review's three must-fixes (LVGL allocator for the PNG decode, a wider QR quiet zone, portal only on an explicit request from the Wi-Fi screen) are the last fix batch and were in flight when this handoff was written; check `git log` for it before the PR.

Not verified in this phase: the Wokwi scenarios were not run locally (no `wokwi-cli` on the workstation; CI runs them only with `WOKWI_CLI_TOKEN`), and the `crowpanel` build was never flashed to the bench unit. Task 17 Step 2 (the full verification command) is still to run.

## The `[feedme2]` event-line contract

One line per transition or sync outcome, `[feedme2] <name> <key=value …>`, written through `LogService::event()` (serial at `info` plus the upload queue) unless marked raw. The Wokwi scenarios in `firmware/wokwi/` assert these literally, in order: **renaming a line or reordering two of them changes a scenario.**

| Line | Fields | Printed by |
|---|---|---|
| `boot ok` | `fw=<version> paired=0\|1 cats=<n>` | `App::begin` |
| `screen=<name>` | `from=<name>`; names `boot pair idle amount fed history system wifi about unpair` | `App::flushScreenChange`, once per change, before the sync round the change triggers |
| `idle` | `cat=<name\|all\|none> level=fed\|content\|peckish\|hungry\|very_hungry\|starving` (`none` when the house has no cats) | `App::printIdle`, on entering Idle, on rotate and when a round changes the state |
| `amount` | `cat=<name\|all> mg=<n> text=<amount text>` | `App::printAmount`, on every rotate on Amount |
| `fed` | `cat=<name\|all> mg=<total> n=<feedings>` | `App::onAmount` on the confirming Press |
| `feeding queued` | `id=<uuid> cat=<catId> mg=<n>` | `FeedingService::commit`, one per draft |
| `pair start` | `code=<6 digits>` | `PairCoordinator::startAt` |
| `paired` | `house=<houseId>` | `PairCoordinator` on `confirmed` |
| `unpaired` | `by=menu` | `App` on the long press of Unpair confirm (a server 401 prints `sync stopped … status=401` instead) |
| `sync start` | `reason=boot\|paired\|feeding\|wake\|timer` | `SyncService::runRound` |
| `sync ok` | `accepted=<n> state=changed\|same` | `SyncService::runRound` when every step passed |
| `sync stopped` | `at=feedings\|logs\|state\|heartbeat status=<n>` (0 = transport failure, 401 = unpaired) | `SyncService::stop` / `unauthorized`; a non-401 heartbeat failure only warns |
| `power` | `tier=awake\|dim\|sleep` | `PowerManager::enter` |
| `input=<Name>` | the parsed serial command (`Press DoubleTap LongPress RotateCW RotateCCW None`) | `main.cpp` `SimInput`, **simulator only**, raw sink |
| `portal start ap=…`, `portal scanned=<n> named=<n>`, `portal up ip=…`, `portal saved ssid_len=<n>`, `portal save failed` | — | `WifiCaptivePortal`, hardware only, raw `Serial` (not in the upload queue) |
| `littlefs mount failed` | — | `LittleFsQueue`, raw `Serial` |

The order the firmware prints after a cold boot without a token is pinned by `boot.scenario.yaml`: `boot ok` → `screen=pair` → `pair start code=424242` → `paired house=` → `screen=idle` → `sync ok accepted=0 state=changed` → `idle cat=Mochi level=`. The roster only arrives with the `paired` round, so `sync ok` comes before the first `idle cat=Mochi`.

## Design decisions taken beyond the plan

- **Poll secret.** `PairCoordinator::startAt` draws a fresh 16-byte hex secret for every start (RAM only, never stored); the server keeps only its hash, so a stale secret would answer `pending` forever. `unknown` and `expired` both restart after 2 s; a Press on the Pair screen restarts only when no code is live.
- **Lazy log compaction.** `LogService` appends every line to `/logs.jsonl` and rewrites the file only once it holds more than 600 lines (twice the 300-line ring), because rewriting 300 lines on every log past the cap would wear LittleFS on a device stuck offline. `loadFromDisk` keeps the newest 300 either way. Messages are cut at 500 chars on a UTF-8 boundary; `data` over 1 KB is dropped.
- **A 2xx whose body is not a feedings response is transient.** `decodeFeedingsResponse` accepts only an object with an `accepted` array; an empty body or a captive portal's HTML keeps the queue and stops the round (`4027137`). Before that fix such a body settled the batch and lost the feedings.
- **60 s retry after a stopped round.** A round that stopped on a transient failure re-arms the timer at `kRetryAfterMs` (60 s) instead of the house's sync interval (6 h by default); a 401 is excluded because the device is unpaired until it pairs again.
- **401 clears the cached state.** `SyncService::unauthorized` clears the token and erases the NVS `state` and `etag` keys and the in-RAM state, so a re-pair into another house never renders the old roster and the next `GET` is unconditional. The *menu* unpair clears only the token (see the decisions below).
- **Stuck-hold timeout.** A hold longer than 10 s (`PowerManager::kMaxHoldMs`, a finger resting on the glass or a stuck touch INT) stops resetting the idle timer, so the device still dims and sleeps.
- **`SimPower` naps as `delay(10)`.** Under `-DSIMULATOR=1` `lightSleep()` is a 10 ms delay so `loop()` keeps pumping the serial channel; the next serial command is the wake event `PowerManager` swallows.
- **`FakeNetwork` checks the token.** Every `/device` call must carry the token the fake issued (`sim-token`); anything else is 401, like a real server answering a token from an earlier pairing. `pairCheck` with a different `pollSecret` answers `pending` forever.
- **QR quiet zone.** The pair QR sits in a white border so phone cameras lock on against the dark theme (4 px in `944eedc`; the Task 14 fix batch widens it to at least 8 px).
- **Captive portal only on request.** On boot the portal runs only when the device is unpaired *and* the join failed or there are no credentials; a paired device keeps serving the cached state and `WifiStation::ensureConnected()` retries from `loop()`. Otherwise the portal opens only from the Wi-Fi menu entry while offline (the Task 14 fix batch makes that an explicit Press on the Wi-Fi screen rather than entering it).
- **Screen line before the round.** With the network up a sync round runs synchronously inside `App::tick`, and wokwi-cli's `wait-serial` never rescans, so `screen=…` is flushed before `sync_.tick()` (`7d67ac8`).
- **Timestamps before the first sync.** Feedings committed before any server `now` carry the monotonic clock; the server clamps them to its now (Phase 2a `clampFedAt`), which is nearer the truth than a cached snapshot plus uptime.
- **`uiGeneration()`** is a fingerprint of everything the screens render from, including the hunger level and the wall-clock minute, so Idle re-renders when a threshold passes with no input.
- **`StateCodec.h` / `QueueCodec.h` include `<ArduinoJson.h>` on purpose**: ArduinoJson is the one third-party header allowed in `application/` (it compiles on native).
- **IFileQueue return values are mostly ignored** by `LogService` / `FeedingService` (a failed rewrite silently desyncs RAM from disk); `SyncService` does check `write(state)` and erases the ETag on failure.

## Known limitations and bench items (Phase 2b)

- **Manual light sleep drops the Wi-Fi association** (`esp_light_sleep_start()`; only esp_pm's automatic light sleep coordinates with modem sleep), contrary to spec §5.5. `main.cpp` calls `WifiStation::ensureConnected()` after every wake and the first sync after a wake may stop as transient and retry after 60 s. Correction note in `docs/spikes/2026-09-deep-sleep-touch-wake.md`.
- **USB-CDC drops in light sleep** (`ARDUINO_USB_CDC_ON_BOOT=1` on crowpanel): the console disappears while asleep and the host may have to reopen the port.
- **A stuck touch INT (held low)** makes `EspPower::lightSleep` return at once every tick: a board-level nap loop. The 10 s hold timeout keeps the tiers moving but not the power. Bench item; if short taps are lost after a wake, latch the INT edge as a one-shot `isHeld()`.
- **Cat PNG re-decoded per redraw** with `LV_CACHE_DEF_SIZE 0`: every Idle rebuild inflates the 130 px PNG (about 68 KB of output). The starving pulse is a comet on the ring that invalidates only two sectors so the cat is not re-inflated per frame. The Task 14 fix batch switches LVGL to the C allocator so the decode goes to heap/PSRAM instead of the 64 KB builtin pool. Profile on hardware.
- **Generated cat sources are 268 KB** (`du -b firmware/src/assets/cats/*.c`) against the plan's 250 KB cap; the flash cost is about 74 KB of PNG bytes, which meets spec D2. Plan correction below.
- **Wokwi scenarios not run locally**; CI runs them only when `WOKWI_CLI_TOKEN` is set, otherwise the five matrix jobs skip with a warning.
- **The crowpanel build was never flashed** in this phase (no board on the bench). First things to check on hardware: the LCD rail (GPIO 1) before `tft.init()`, the encoder direction, the CST816D gesture synthesis, the LEDC backlight PWM, the light-sleep wake pins, and the SNTP + TLS handshake against the worker.
- `WifiNetwork` uses `setInsecure()` (Cloudflare's rotating edge certificate); pinning is a Phase 3 item.
- The System menu has four entries (Wi-Fi, Pair/Unpair, About, Sleep now); the Update and Login-QR entries of spec §5.2 are Phase 3/5.
- Touch has no DoubleTap (the knob owns it); a touch hold fires LongPress eagerly.
- No wall clock without a server: `ClockModel` stays unsynced until a `now` arrives (feedings response, state or heartbeat); until then `App::wallNowMs` runs from the cached state's `now` plus uptime, or from the monotonic clock when there is no cache.

## Decisions pending for Andrey

1. **Should the menu unpair also clear the cached state?** A server 401 erases `state`/`etag` (the old house must not render after a re-pair), but "Unpair" from the menu clears only the token, so Idle still shows the old roster until the new pairing's first round (`pair.scenario.yaml` relies on this: it asserts only `sync ok accepted=0`). Clearing in both paths is one line in `App::dispatch`; the scenario would then assert `state=changed`.
2. **Pin the Cloudflare certificate now or in Phase 3?** `WifiNetwork` is `setInsecure()`. Pinning the Cloudflare root (not the leaf) survives rotation but needs a bundle update path; the plan put it in Phase 3 with OTA.
3. **The Wokwi secret.** PR #2's CI ran HIL-2 green, so `WOKWI_CLI_TOKEN` may already be set; confirm in the repository secrets before relying on the five scenario jobs.
4. **Asset cap.** Accept 268 KB of generated source (74 KB in flash) and relax the plan, or drop the four unused poses (spec Q3 ships five of twelve).

## Plan corrections

- **Boot scenario order.** The plan's `boot.scenario.yaml` (Task 15) waited for `idle cat=Mochi level=` before `sync ok accepted=0 state=changed`. The firmware prints `sync ok` first because the roster only exists after the `paired` round; `boot.scenario.yaml` and `pair.scenario.yaml` follow the firmware order. The plan text is left as written and this note records the correction.
- **250 KB asset cap** (Task 13 Step 2). The 24 generated files total 268 673 bytes of C source; the compiled PNG bytes are about 74 KB, within spec D2. Treat the cap as 275 KB of source or measure flash bytes instead.

## Follow-ups (none blocking)

- Handle `IFileQueue` failures in `LogService` / `FeedingService` (at least a warn and a re-persist on the next write).
- `Cst816Touch`: latch the INT edge if taps are lost after a wake (bench).
- `WifiStation`: move `configTime` into `ensureConnected`'s connected transition and drop the blocking boot join once the portal decision is explicit.
- Profile the Idle rebuild cadence on hardware; consider a small LVGL image cache once PSRAM allocation is confirmed.
- The deep-sleep bench spike (`docs/spikes/2026-09-deep-sleep-touch-wake.md`) is still open for Phase 3; Phase 2b stops at light sleep.
- Native test target for Phase 3 is 150 cases (spec §5.7); 132 now.

## Process notes

- Several agents shared one checkout: pathspec-only staging, the commit lock (`mkdir .git/feedme2-commit.lock`), never `git add -A`. `firmware/scripts/png_to_c.py` shows as modified (line endings only); it was never staged.
- Every firmware commit stages `firmware/src/application/Version.h`; the hook bumped it from 0.1.8 to 0.1.31 over the branch. Doc-only commits bump nothing.
- Reviews ran per task with a separate agent; fix batches were sequenced so no two agents edited `runner.cpp` or `test_app.cpp` at the same time.

## Next steps

1. Land the Task 14 fix batch (allocator, QR quiet zone, portal on request) if it has not committed yet; re-run `pio test -e native` and both builds.
2. Task 17 Step 2: `pnpm -r typecheck && pnpm -r test && python -m unittest discover -s scripts && (cd firmware && pio test -e native && pio run -e crowpanel && pio run -e simulator) && BASE_REF=origin/main python scripts/check_version_bump.py`.
3. Merge PR #2 (Phase 2a), rebase this branch onto `main`, push, open **"Phase 2b: firmware MVP"** (body per plan Task 17 Step 3: spec/plan links, 132 native cases, binary sizes, the Wokwi token note, `pio run -e crowpanel -t upload` for the bench).
4. Watch CI: version check, native tests, both builds, the five Wokwi jobs (or their skip warnings).
5. Flash the bench unit, pair it against production and work through the hardware checklist above; then Phase 3 (OTA, deep sleep, certificate pinning).
