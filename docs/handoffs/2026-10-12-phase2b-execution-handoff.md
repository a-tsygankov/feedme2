# Phase 2b execution handoff — 2026-10-12

Branch `feat/phase2b-firmware-mvp`, stacked on `feat/phase2a-device-api` (PR #2, CI green, merge left to Andrey): 24 firmware commits from `dbd7932` to `5a85acb`, the first docs commit `57fa3a8`, then four fix commits (`b8f0914` for the Task 14 review; `7a0d190`, `1e8db93`, `32fb7e5` around the whole-branch review) and this docs refresh; not pushed, no PR yet. Plan: `docs/superpowers/plans/2026-10-11-phase2b-firmware-mvp.md` (Tasks 1–16 and Task 17 Step 1 ticked; Steps 2–3, full verification and the PR, are the dispatcher's). Spec: `docs/superpowers/specs/2026-09-20-feedme2-design.md` §1.2, §1.5–1.7, §5, §6.1–6.2, §7 row "2 Device MVP". Device API: the Phase 2a handoff. Live state: `handoff.md`.

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
| 8 | `SyncService`: feedings → logs → state (ETag) → heartbeat in one round; `RoundResult`; 401 handling | `b6d5062`; non-JSON 2xx, 60 s retry, 401 clears cached state `4027137`; one request per tick, only the backend's 401 unpairs, `forgetState()` `32fb7e5` |
| 9 | `PowerManager`: Awake → Dim (15 s) → LightSleep (30 s), swallowed wake event, timer wake | `7b7af0c`; sleep-out before backlight, stuck-hold timeout `85724ec` |
| 10 | `App`: screen routing, the knob grammar of §5.2, sync and power glue, `[feedme2]` screen / idle / amount / fed lines | `bfb1362`; screen line before the round it triggers, UI generation tracks hunger time `7d67ac8`; portal on an explicit Press `b8f0914`; offline devices sleep (`kJoinGraceMs`), state applied at round end, Fed timer armed after its first frame, menu unpair clears the state `32fb7e5` |
| 11 | ESP32 adapters: `ArduinoClock`, `EspRandom`, `NvsStorage`, `LittleFsQueue`, `RotaryInput`, `Cst816Touch`, `CompositeInput`, `EspPower` + `LedRing`, `SerialLogSink` | `65623a1`; atomic appends, LED rail off at zero, shared wake pins, quiet NVS first boot `44f97fc` |
| 12 | `WifiStation` (NVS `wifi` blob, SNTP, `ensureConnected`), `WifiCaptivePortal` (howler's flow), `WifiNetwork` (HTTPS, `setInsecure`); simulator `FakeNetwork` (seeded by `scripts/embed_fixture.py` → `FakeState.h`) and `SimulatedClock` | `085c7f5`; portal logs the SSID length, sim speed pinned, fake-server caveats `7f0a306`; 15 s join budget `7a0d190`; `setReuse(false)`, rejoin after every light sleep, portal only without credentials plus a 10-minute idle timeout, knob held at boot opens the portal `1e8db93` |
| 13 | Cat silhouettes as PNG C arrays, 130 px (Idle) and 88 px (Fed), `assets/cats/render.py` → `firmware/scripts/png_to_c.py`, `CatAssets.h` | `3104212` |
| 14 | LVGL screens (pair with QR, idle with hunger ring, amount, fed, history, system, wifi, about, unpair) and `main.cpp` for crowpanel and simulator | `944eedc`; LVGL on the C heap, 8 px QR quiet zone `b8f0914` |
| 15 | Wokwi scenarios `boot`, `pair`, `feed`, `feed_all`, `system_menu`; `firmware-hil2` matrix in CI | `8fc6922` |
| 16 | Native test audit: **132** Unity cases (`pio test -e native`); **142** after the review fix batches | `5a85acb` |
| 17 | This handoff, `handoff.md`, README, CLAUDE.md, spike note, plan ticks | `57fa3a8`; refreshed after the whole-branch review fixes |

Binary sizes after Task 12 (before the screens landed): crowpanel 555 725 B, simulator 560 005 B. The PR body should quote the current `pio run` output.

## How it was verified

Every task ran `pio test -e native` and, for anything under `adapters/`, `screens/` or `main.cpp`, `pio run -e crowpanel && pio run -e simulator`. The native summary at Task 16 reads `132 test cases: 132 succeeded`. Each task was reviewed by a separate agent before the next one started; the must-fixes were applied in fix batches (Task 6: `220c8da`; Task 8: `4027137`; Task 10 ordering: `7d67ac8`; adapters: `44f97fc`, `7f0a306`; domain nits: `bc8c1d0`; application nits: `85724ec`). The Task 14 review's three must-fixes (LVGL allocator for the PNG decode, a wider QR quiet zone, portal only on an explicit request from the Wi-Fi screen) landed as `b8f0914`. After the whole-branch review fixes the native summary reads `142 test cases: 142 succeeded` (firmware 0.1.36).

Not verified in this phase: the Wokwi scenarios were not run locally (no `wokwi-cli` on the workstation; CI runs them only with `WOKWI_CLI_TOKEN`), and the `crowpanel` build was never flashed to the bench unit. Task 17 Step 2 (the full verification command) is still to run.

## Whole-branch review (at `7a0d190`)

**Verdict: not mergeable until two must-fixes land.** Both landed as fix batches; the rest of the review is the should-fix list below.

1. **Wi-Fi on hardware** (`7a0d190`, `1e8db93`). Just before the review, `7a0d190` stopped `ensureConnected()` from re-issuing `WiFi.begin()` every 5 s, which restarted any join slower than that: a join now gets `WifiStation::kJoinBudgetMs` (15 s) unless the stack reports a definitive failure. The review then found three problems, fixed in `1e8db93`:
   - `HTTPClient` kept the TLS connection alive, and a response without `Content-Length` (a 304 or a 202 from the edge) made `getString()` read until Cloudflare's idle timeout, freezing `loop()`. `WifiNetwork` now calls `setReuse(false)`: one request per TLS connection.
   - After a manual light sleep `WiFi.status()` still read `WL_CONNECTED` over a dead link, so the wake round failed and waited 60 s. `main.cpp` wraps `EspPower` in `StationAwarePower`, whose `lightSleep()` calls `WifiStation::noteWake()` the moment the nap returns: `disconnect()` (bounded 150 ms settle) and a fresh `begin()` booked as a join with the 15 s budget. `wifiHousekeeping()` probes once a second in every tier.
   - The boot rule "unpaired and the join failed within 15 s → portal" stranded a device whose router was still rebooting after a power blip. The portal now opens by itself only with no saved credentials on an unpaired device (spec §1.2), and `WifiCaptivePortal` restarts the device after `kIdleTimeoutMs` (10 min) with no client on the AP and no request. Otherwise it opens on a Press on the Wi-Fi screen (`portal requested`) or with the knob button held through boot (decision 5 below).
2. **Sync blocked the loop** (`32fb7e5`). A round ran every request in one `App::tick`: 3–5 s on the S3, up to 32 s at the 8 s timeouts, freezing the Fed screen and the knob. `SyncService` is now a step machine (feedings → logs → state → heartbeat) that makes at most one request per `tick()`; `roundInProgress()` is true from the tick that starts a round to the one that completes or stops it, and `sync ok` / `sync stopped` print at the end. A state fetched mid-round is applied by `App` only when the round completes, so `sync ok` still precedes `idle cat=…`. The same batch:
   - **Offline devices sleep.** `holdAwake` used to be "a round requested or a feeding queued", which kept a paired device with no reachable AP at Dim forever. `App` now holds awake only while a round is in progress, or requested on a paired device that is online or within `App::kJoinGraceMs` (15 s, the join budget) of the request or of a timer wake.
   - **Only the backend's 401 unpairs.** Under `setInsecure()` any peer (a hotel portal, a proxy) can answer 401. `SyncService::revoked()` requires the body `{"error":"unauthorized"}` (`requireDevice`); any other 401 warns `401 not from the api` and stops the round as transient (60 s retry).
   - **Menu unpair clears the cached state** through the new `SyncService::forgetState()`, as the 401 path does (decision 1, resolved); `pair.scenario.yaml` now asserts `sync ok accepted=0 state=changed`. A menu unpair between two steps of a round drops it with the info line `sync abandoned` instead of sending the rest without a token.
   - The Fed screen's 2 s start on the first tick after it was rendered, not at commit (a slow tick popped it after one frame).

## The `[feedme2]` event-line contract

One line per transition or sync outcome, `[feedme2] <name> <key=value …>`, written through `LogService::event()` (serial at `info` plus the upload queue) unless marked raw. The Wokwi scenarios in `firmware/wokwi/` assert these literally, in order: **renaming a line or reordering two of them changes a scenario.**

| Line | Fields | Printed by |
|---|---|---|
| `boot ok` | `fw=<version> paired=0\|1 cats=<n>` | `App::begin` |
| `screen=<name>` | `from=<name>`; names `boot pair idle amount fed history system wifi about unpair` | `App::flushScreenChange`, once per change, before the sync round the change triggers |
| `idle` | `cat=<name\|all\|none> level=fed\|content\|peckish\|hungry\|very_hungry\|starving` (`none` when the house has no cats) | `App::printIdle`, on entering Idle, on rotate and when a round that changed the state completes |
| `amount` | `cat=<name\|all> mg=<n> text=<amount text>` | `App::printAmount`, on every rotate on Amount |
| `fed` | `cat=<name\|all> mg=<total> n=<feedings>` | `App::onAmount` on the confirming Press |
| `feeding queued` | `id=<uuid> cat=<catId> mg=<n>` | `FeedingService::commit`, one per draft |
| `pair start` | `code=<6 digits>` | `PairCoordinator::startAt` |
| `paired` | `house=<houseId>` | `PairCoordinator` on `confirmed` |
| `unpaired` | `by=menu` | `App` on the long press of Unpair confirm; clears the token and the cached state (a backend revocation prints `sync stopped … status=401` instead) |
| `sync start` | `reason=boot\|paired\|feeding\|wake\|timer` | `SyncService::startRound`; the round's first request goes out in the same tick, the rest one per tick |
| `sync ok` | `accepted=<n> state=changed\|same` | `SyncService::finishRound`, on the tick the last step completes |
| `sync stopped` | `at=feedings\|logs\|state\|heartbeat status=<n>` (0 = transport failure) | `SyncService::stop` / `unauthorized`. `status=401` has two meanings, told apart by the warn just before it: `device unpaired by server` (the body was the backend's `{"error":"unauthorized"}`: token and cached state cleared, back to Pair, no retry) or `401 not from the api` (any other 401: transient, 60 s retry). A heartbeat failure that is not a revocation only warns |
| `power` | `tier=awake\|dim\|sleep` | `PowerManager::enter` |
| `portal requested` | — | `App::dispatch` on a Press on the Wi-Fi screen; `main.cpp` then runs the portal (the simulator drops the request) |
| `input=<Name>` | the parsed serial command (`Press DoubleTap LongPress RotateCW RotateCCW Touch None`; `Touch` acts as a Press) | `main.cpp` `SimInput`, **simulator only**, raw sink |
| `portal start ap=…`, `portal scanned=<n> named=<n>`, `portal up ip=…`, `portal saved ssid_len=<n>`, `portal save failed`, `portal idle timeout, restarting` | — | `WifiCaptivePortal`, hardware only, raw `Serial` (not in the upload queue) |
| `littlefs mount failed` | — | `LittleFsQueue`, raw `Serial` |

Not an event line: `sync abandoned` is an ordinary info log (`{"at":"<step>"}`) from `SyncService::tick` when the menu unpaired the device between two steps of a round; no scenario asserts it.

The order the firmware prints after a cold boot without a token is pinned by `boot.scenario.yaml`: `boot ok` → `screen=pair` → `pair start code=424242` → `paired house=` → `screen=idle` → `sync ok accepted=0 state=changed` → `idle cat=Mochi level=`. The roster only arrives with the `paired` round and `App` applies a fetched state only when the round completes, so `sync ok` comes before the first `idle cat=Mochi`. After a menu unpair the cached state is gone too, so the re-pair round in `pair.scenario.yaml` ends `sync ok accepted=0 state=changed`.

## Design decisions taken beyond the plan

- **Poll secret.** `PairCoordinator::startAt` draws a fresh 16-byte hex secret for every start (RAM only, never stored); the server keeps only its hash, so a stale secret would answer `pending` forever. `unknown` and `expired` both restart after 2 s; a Press on the Pair screen restarts only when no code is live.
- **Lazy log compaction.** `LogService` appends every line to `/logs.jsonl` and rewrites the file only once it holds more than 600 lines (twice the 300-line ring), because rewriting 300 lines on every log past the cap would wear LittleFS on a device stuck offline. `loadFromDisk` keeps the newest 300 either way. Messages are cut at 500 chars on a UTF-8 boundary; `data` over 1 KB is dropped.
- **A 2xx whose body is not a feedings response is transient.** `decodeFeedingsResponse` accepts only an object with an `accepted` array; an empty body or a captive portal's HTML keeps the queue and stops the round (`4027137`). Before that fix such a body settled the batch and lost the feedings.
- **60 s retry after a stopped round.** A round that stopped on a transient failure re-arms the timer at `kRetryAfterMs` (60 s) instead of the house's sync interval (6 h by default); a backend revocation is excluded because the device is unpaired until it pairs again, while a 401 that is not the backend's is transient and retried.
- **Unpairing clears the cached state.** `SyncService::forgetState()` erases the NVS `state` and `etag` keys and the in-RAM state, so a re-pair into another house never renders the old roster and the next `GET` is unconditional. Both paths call it: the backend's 401 (`unauthorized`, which also clears the token) and, since `32fb7e5`, the menu Unpair.
- **Only the backend's 401 unpairs.** `SyncService::revoked()` accepts a 401 as a revocation only when the body is `{"error":"unauthorized"}`; under `setInsecure()` any TLS peer could otherwise wipe the pairing (`32fb7e5`).
- **One request per tick.** A sync round is a step machine; each `tick()` makes at most one request and the round spans several loop iterations, so rendering and the knob keep running (`32fb7e5`). `App` applies a state fetched mid-round when the round completes, and its UI fingerprint follows the applied generation, not the one mid-round.
- **Hold awake only when a round can run.** `App` passes `holdAwake(roundInProgress() || (requested && paired && (online || within kJoinGraceMs)))`; a queued feeding alone no longer keeps the device out of light sleep (`32fb7e5`).
- **One request per TLS connection.** `WifiNetwork` sets `setReuse(false)` (`Connection: close`): a kept-alive response without `Content-Length` read until the edge's idle timeout (`1e8db93`).
- **Rejoin after every light sleep.** `StationAwarePower` calls `WifiStation::noteWake()` as `lightSleep()` returns: disconnect, then a fresh join with the 15 s budget, before the wake round reads the link (`1e8db93`).
- **Stuck-hold timeout.** A hold longer than 10 s (`PowerManager::kMaxHoldMs`, a finger resting on the glass or a stuck touch INT) stops resetting the idle timer, so the device still dims and sleeps.
- **`SimPower` naps as `delay(10)`.** Under `-DSIMULATOR=1` `lightSleep()` is a 10 ms delay so `loop()` keeps pumping the serial channel; the next serial command is the wake event `PowerManager` swallows.
- **`FakeNetwork` checks the token.** Every `/device` call must carry the token the fake issued (`sim-token`); anything else is 401, like a real server answering a token from an earlier pairing. `pairCheck` with a different `pollSecret` answers `pending` forever.
- **QR quiet zone.** The pair QR sits in a white border so phone cameras lock on against the dark theme (4 px in `944eedc`; `b8f0914` makes it an 8 px white parent box around the QR).
- **Captive portal only without credentials, or on request.** On boot the portal opens by itself only when the device is unpaired *and* has no saved credentials (spec §1.2); with credentials it keeps joining however long the network is away, and `WifiStation::ensureConnected()` retries once a second from `loop()`. Otherwise the portal opens on a Press on the Wi-Fi screen (`portal requested`, `b8f0914`) or with the knob button held through boot (`1e8db93`, decision 5). With nobody on the AP and no request for 10 minutes it restarts into a normal boot.
- **Screen line before the round.** The round's first request (and its `sync start`) runs inside `sync_.tick()` in the same `App::tick`, and wokwi-cli's `wait-serial` never rescans, so `screen=…` is flushed before `sync_.tick()` (`7d67ac8`).
- **Timestamps before the first sync.** Feedings committed before any server `now` carry the monotonic clock; the server clamps them to its now (Phase 2a `clampFedAt`), which is nearer the truth than a cached snapshot plus uptime.
- **`uiGeneration()`** is a fingerprint of everything the screens render from, including the hunger level and the wall-clock minute, so Idle re-renders when a threshold passes with no input.
- **`StateCodec.h` / `QueueCodec.h` include `<ArduinoJson.h>` on purpose**: ArduinoJson is the one third-party header allowed in `application/` (it compiles on native).
- **IFileQueue return values are mostly ignored** by `LogService` / `FeedingService` (a failed rewrite silently desyncs RAM from disk); `SyncService` does check `write(state)` and erases the ETag on failure.

## Known limitations and bench items (Phase 2b)

- **Manual light sleep drops the Wi-Fi association** (`esp_light_sleep_start()`; only esp_pm's automatic light sleep coordinates with modem sleep), contrary to spec §5.5. Every nap therefore costs a 3–8 s rejoin: `StationAwarePower` calls `WifiStation::noteWake()` (disconnect + `begin()` with the 15 s join budget) as soon as the nap returns, and a requested round (wake, timer) holds the device awake for up to `App::kJoinGraceMs` (15 s) waiting for it. A paired device whose network stays away dims and sleeps; its next timer wake tries again, and a round that stops on a transient failure retries after 60 s. Correction note in `docs/spikes/2026-09-deep-sleep-touch-wake.md`.
- **USB-CDC drops in light sleep** (`ARDUINO_USB_CDC_ON_BOOT=1` on crowpanel): the console disappears while asleep and the host may have to reopen the port.
- **A stuck touch INT (held low)** makes `EspPower::lightSleep` return at once every tick: a board-level nap loop. The 10 s hold timeout keeps the tiers moving but not the power. Bench item; if short taps are lost after a wake, latch the INT edge as a one-shot `isHeld()`.
- **Cat PNG re-decoded per redraw** with `LV_CACHE_DEF_SIZE 0`: every Idle rebuild inflates the 130 px PNG (about 68 KB of output). The starving pulse is a comet on the ring that invalidates only two sectors so the cat is not re-inflated per frame. `b8f0914` switched LVGL to the C allocator so the decode goes to heap/PSRAM instead of the 64 KB builtin pool. Profile on hardware.
- **Generated cat sources are 268 KB** (`du -b firmware/src/assets/cats/*.c`) against the plan's 250 KB cap; the flash cost is about 74 KB of PNG bytes, which meets spec D2. Plan correction below.
- **Wokwi scenarios not run locally**; CI runs them only when `WOKWI_CLI_TOKEN` is set, otherwise the five matrix jobs skip with a warning.
- **The crowpanel build was never flashed** in this phase (no board on the bench). First things to check on hardware: the LCD rail (GPIO 1) before `tft.init()`, the encoder direction, the CST816D gesture synthesis, the LEDC backlight PWM, the light-sleep wake pins, and the SNTP + TLS handshake against the worker.
- `WifiNetwork` uses `setInsecure()` (Cloudflare's rotating edge certificate); pinning is a Phase 3 item (decision 2). Each request opens its own TLS connection (`setReuse(false)`), a handshake per call.
- **Captive portal idle timeout.** The portal restarts the device after 10 minutes with no client on the AP and no request; a phone on the AP keeps it open. An unpaired device with no credentials comes straight back to it.
- The System menu has four entries (Wi-Fi, Pair/Unpair, About, Sleep now); the Update and Login-QR entries of spec §5.2 are Phase 3/5.
- Touch has no DoubleTap (the knob owns it); a touch hold fires LongPress eagerly.
- No wall clock without a server: `ClockModel` stays unsynced until a `now` arrives (feedings response, state or heartbeat); until then `App::wallNowMs` runs from the cached state's `now` plus uptime, or from the monotonic clock when there is no cache.

## Decisions pending for Andrey

1. ~~Should the menu unpair also clear the cached state?~~ **Resolved in `32fb7e5`:** the menu Unpair calls `SyncService::forgetState()` like the backend's 401, and `pair.scenario.yaml` asserts `sync ok accepted=0 state=changed`.
2. **Pin the Cloudflare certificate now or in Phase 3?** `WifiNetwork` is `setInsecure()`. Pinning the Cloudflare root (not the leaf) survives rotation but needs a bundle update path; the plan put it in Phase 3 with OTA.
3. **The Wokwi secret.** PR #2's CI ran HIL-2 green, so `WOKWI_CLI_TOKEN` may already be set; confirm in the repository secrets before relying on the five scenario jobs.
4. **Asset cap.** Accept 268 KB of generated source (74 KB in flash) and relax the plan, or drop the four unused poses (spec Q3 ships five of twelve).
5. **Knob button held during boot opens the Wi-Fi portal** (`1e8db93`). It is the only way for an unpaired device whose saved password is wrong to reach the portal: the portal no longer opens by itself when credentials exist, and the Pair screen has no route to the Wi-Fi screen. Keep this gesture (and put it in the user-facing setup notes) or pick another, for example a menu on the Pair screen.

## Plan corrections

- **Boot scenario order.** The plan's `boot.scenario.yaml` (Task 15) waited for `idle cat=Mochi level=` before `sync ok accepted=0 state=changed`. The firmware prints `sync ok` first because the roster only exists after the `paired` round; `boot.scenario.yaml` and `pair.scenario.yaml` follow the firmware order. The plan text is left as written and this note records the correction.
- **250 KB asset cap** (Task 13 Step 2). The 24 generated files total 268 673 bytes of C source; the compiled PNG bytes are about 74 KB, within spec D2. Treat the cap as 275 KB of source or measure flash bytes instead.

## Should fix before Phase 3

From the whole-branch review; none blocks the Phase 2b PR.

- **Synchronous LittleFS append per log event.** `LogService::event()` appends to `/logs.jsonl` on every line, i.e. on every knob detent on Amount; batch the appends and persist on a timer.
- **Two sync timers anchored differently.** `PowerManager` (timer wake while asleep) and `SyncService` (interval since the last round) each keep the sync interval from a different anchor; give it one owner or a shared anchor.
- **Snapshot-clock age fallback.** Before the first server `now`, `App::wallNowMs` runs from the cached snapshot plus uptime, which underestimates the age after a power-off; RF4 wanted "—" until synced.
- **`LittleFS.begin(format)` before the first frame.** A mount that formats runs before anything is on the glass; draw first or report it.
- **`IFileQueue` results ignored in `FeedingService::commit`** (and in `LogService`): a failed append or rewrite silently desyncs RAM from disk; at least warn and re-persist on the next write.
- **CI firmware jobs do not retrigger on `deploy.yml` edits** (the path filter), so a workflow change can merge without the firmware jobs having run on it.
- **About screen uptime** reads `lv_tick_get()` instead of `IClock`, so it bypasses the app's time source (and the simulator's sped-up clock).
- **Certificate pinning** (`setInsecure()` today; decision 2).

## Follow-ups (none blocking)

- `Cst816Touch`: latch the INT edge if taps are lost after a wake (bench).
- Profile the Idle rebuild cadence on hardware; consider a small LVGL image cache once PSRAM allocation is confirmed.
- The deep-sleep bench spike (`docs/spikes/2026-09-deep-sleep-touch-wake.md`) is still open for Phase 3; Phase 2b stops at light sleep.
- Native test target for Phase 3 is 150 cases (spec §5.7); 142 now.

## Process notes

- Several agents shared one checkout: pathspec-only staging, the commit lock (`mkdir .git/feedme2-commit.lock`), never `git add -A`. `firmware/scripts/png_to_c.py` showed as modified (line endings only) during the work; it was never staged, and the tree is clean now.
- Every firmware commit stages `firmware/src/application/Version.h`; the hook bumped it from 0.1.8 to 0.1.36 over the branch (0.1.36 is this docs refresh, which also rewrote the `PowerManager::holdAwake` comment). Doc-only commits bump nothing.
- Reviews ran per task with a separate agent; fix batches were sequenced so no two agents edited `runner.cpp` or `test_app.cpp` at the same time.

## Next steps

1. Task 17 Step 2: `pnpm -r typecheck && pnpm -r test && python -m unittest discover -s scripts && (cd firmware && pio test -e native && pio run -e crowpanel && pio run -e simulator) && BASE_REF=origin/main python scripts/check_version_bump.py`.
2. Merge PR #2 (Phase 2a), rebase this branch onto `main`, push, open **"Phase 2b: firmware MVP"** (body per plan Task 17 Step 3: spec/plan links, 142 native cases, binary sizes, the Wokwi token note, `pio run -e crowpanel -t upload` for the bench).
3. Watch CI: version check, native tests, both builds, the five Wokwi jobs (or their skip warnings).
4. Flash the bench unit, pair it against production and work through the hardware checklist above (add: the rejoin after each light sleep, the portal idle timeout, the knob-held-at-boot portal); then the should-fix list and Phase 3 (OTA, deep sleep, certificate pinning).
