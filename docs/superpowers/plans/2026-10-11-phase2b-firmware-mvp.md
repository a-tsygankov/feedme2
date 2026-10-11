# Phase 2b: Firmware MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CrowPanel that pairs with a house, shows the selected cat's hunger on the Idle screen, logs a feeding from the knob (single cat or "All cats"), queues feedings offline, syncs on wake/feeding/timer, uploads its logs, dims and light-sleeps when idle, and can be driven end to end in Wokwi without a person — with ≥ 100 host-side Unity tests.

**Architecture:** Ports-and-adapters exactly as spec §5.1: `domain/` and `application/` are plain C++17 with no Arduino headers and are compiled by the `native` env; `ports/` declares the interfaces; `adapters/` hold the ESP32 implementations; `screens/` is LVGL 9.0.0 over TFT_eSPI. Under `-DSIMULATOR=1` the firmware swaps `WifiNetwork` for an in-memory `FakeNetwork` seeded from `fixtures/device-state.sample.json`, reads input from the serial command channel, and prints one machine-readable `[feedme2] …` line per state transition that Wokwi scenarios assert. The device API it speaks is Phase 2a's.

**Tech Stack:** PlatformIO, espressif32 ^6.9 (Arduino), TFT_eSPI 2.5, LVGL 9.0.0 (+ `strip_lvgl_simd.py`), ArduinoJson 7 (also on native), Adafruit NeoPixel, Unity (native), Wokwi CLI scenarios, Python 3 + Pillow (asset rendering).

**Spec:** `docs/superpowers/specs/2026-09-20-feedme2-design.md` — §1.2, §1.5–1.7, §5 (all), §6.1–6.2, §7 row "2 Device MVP". Device API: `docs/superpowers/plans/2026-10-11-phase2a-device-api.md` (shared contracts in `shared/src/device.ts`).

## Global Constraints

- `domain/` and `application/` must compile with no Arduino, LVGL or ESP-IDF headers; the `native` env builds exactly those two directories (`build_src_filter = +<domain/> +<application/>`).
- Board constants (spec §5): GC9A01 on SPI MOSI 11 / SCLK 10 / CS 9 / DC 3 / RST 14 / BL 46; CST816D I²C SDA 6 / SCL 7 / INT 5 / RST 13; encoder A 45 / B 42 / SW 41; WS2812 ×5 on 48; LCD rail enable GPIO 1 (drive HIGH before `tft.init()`); LED rail GPIO 2. These are already in `firmware/platformio.ini`.
- LVGL 9.0.0 pinned; draw buffer `alignas(4) uint8_t[240*40*2]` (16 bpp bytes, not `lv_color_t`); `lv_tick_set_cb(millis)`; `LV_COLOR_DEPTH 16`.
- Input grammar (spec §5.2): Press · DoubleTap · LongPress 600 ms with the perimeter arc · RotateCW/CCW; touch tap = Press, horizontal swipe = rotate.
- Units and hunger mirror `shared/src/{units,hunger}.ts` and must pass every vector in `fixtures/unit-vectors.json` (`toMg`, `steps`) and `fixtures/hunger-vectors.json` (all cases incl. `ageSec`); the state parser must accept `fixtures/device-state.sample.json`. Rounding is round-half-away-from-zero (`std::lround`), values are `double`.
- Machine-readable serial lines (spec §5.7): every screen transition and sync outcome prints `[feedme2] <event> key=value …` on one line; Wokwi scenarios assert these.
- Device id: 32 lowercase hex = 20 zeros + 12 hex MAC chars (howler's `deviceIdFromMac`), `hwModel` `"crowpanel-1.28"` (or `"simulator"` under `-DSIMULATOR=1`).
- Versioning: any non-doc change under `firmware/` or `fixtures/` bumps `firmware/src/application/Version.h` (the pre-commit hook does it; stage the file). Commit style `type(scope): …`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, explicit pathspecs only.
- Native test target: ≥ 100 Unity cases by the end of this plan (spec §7 exit); ≥ 150 is the §5.7 goal for Phase 3.

## Review Focus

1. **The knob turns while the screen is dim or asleep**: a person expects the first turn to wake the screen and nothing else (no accidental cat change or amount change). Pinned in Task 12 (PowerManager swallows the waking event) and Task 11.
2. **Wi-Fi is down when a feeding is logged**: the feeding must survive a reboot and be sent later, exactly once. Pinned in Task 6 (queue persisted per write; `accepted` removes only sent ids) and Task 8 (sync round keeps items on transient failure).
3. **The server says the device is no longer paired (401 on any device call)**: the device must return to the Pair screen, not loop forever. Pinned in Task 8 (401 → `PairCoordinator::clearToken()`, router → Pair).
4. **The device clock is wrong on boot** (RTC lost): a feeding logged before the first sync must carry a time the server will clamp sensibly, and the Idle screen must not show "fed 56 years ago". Pinned in Task 5 (`Clock` marks "unsynced" and uses monotonic time until the server `now` arrives; Hunger shows "—" when unsynced and never fed) and Task 8.
5. **"All cats" with a cat that has no default amount**: a person expects that cat to get the house's sensible default (40 g in the house unit), not to be skipped silently. Pinned in Task 4 (`FeedFlow` falls back to `kFallbackMg = 40000`) and Task 15 scenario.

---

## File structure

```
firmware/
  platformio.ini                      + lib_deps for native (ArduinoJson), -DFEEDME2_SIMULATOR paths, test_build_src
  include/lv_conf.h                   + LV_USE_LODEPNG 1 (PNG decode), LV_USE_QRCODE 1, fonts 12/14/18/24/48
  scripts/render_cat_arrays.py        PNG → C arrays (called from assets/cats/render.py)
  src/
    domain/
      Units.h            toMg, fromMg, stepMg, snapToStep, formatAmountAscii, parseFractionStep   (pure)
      Hunger.h           hungerState, levelName, levelColor                                        (pure)
      Clock.h            ClockModel: monotonic + server offset, isSynced, nowMs                     (pure)
      DeviceState.h      structs mirroring shared DeviceState (house, settings, cats)               (pure)
      CatRoster.h        selection over cats + "All" entry, wrap, pose for level                    (pure)
      FeedFlow.h         Idle→Amount→Fed state machine; single/all; scale factors; drafts           (pure)
      FeedingQueue.h     FIFO of FeedingDraft with ids; drop-oldest cap 200                         (pure)
      Router.h           ScreenId + stack                                                           (pure)
      LongPressArc.h     hold-to-confirm model                                                      (pure)
      SimInput.h         (exists) serial command → event
      Version.h          (exists) compareVersions
    ports/
      IClock.h IInput.h INetwork.h IStorage.h IFileQueue.h IPower.h ILogSink.h IRandom.h
    application/
      Version.h          (exists) kFirmwareVersion
      Events.h           InputEvent enum shared by ports/screens
      StateCodec.h/.cpp  JSON ⇄ DeviceState (ArduinoJson)
      QueueCodec.h/.cpp  FeedingDraft ⇄ JSON line; LogEntry ⇄ JSON line
      LogService.h/.cpp  ring buffer + upload queue + "[feedme2]" event lines
      PairCoordinator.h/.cpp
      SyncService.h/.cpp round: feedings → logs → state(etag) → heartbeat; triggers; 401 handling
      FeedingService.h/.cpp  FeedFlow glue → queue → persist → sync trigger
      PowerManager.h/.cpp    Awake/Dim/LightSleep tiers; swallows the waking event
      App.h/.cpp             wires everything; tick(nowMs)
    adapters/
      ArduinoClock.h EspRandom.h NvsStorage.h LittleFsQueue.h/.cpp
      RotaryInput.h Cst816Touch.h/.cpp CompositeInput.h
      WifiStation.h/.cpp WifiCaptivePortal.h/.cpp WifiNetwork.h/.cpp
      EspPower.h/.cpp LedRing.h/.cpp SerialLogSink.h
      FakeNetwork.h/.cpp (SIMULATOR) SimulatedClock.h (SIMULATOR)
    screens/
      ScreenManager.h/.cpp  LVGL bring-up, input pump, router-driven rebuild
      Theme.h               colours, fonts
      components/RoundMenu.h LongPressArcWidget.h CatImage.h HungerRing.h
      screen_boot.cpp screen_pair.cpp screen_idle.cpp screen_amount.cpp screen_fed.cpp
      screen_history.cpp screen_system.cpp screen_wifi.cpp screen_about.cpp
    assets/cats/            cat_<slug>_130.c / _88.c (generated) + CatAssets.h
    main.cpp
  test/
    test_domain/            runner.cpp + test_units.cpp test_hunger.cpp test_clock.cpp test_roster.cpp test_feedflow.cpp test_queue.cpp test_router.cpp test_arc.cpp (+ existing test_sim_input, test_version)
    test_application/       runner.cpp + stubs.h + test_state_codec.cpp test_queue_codec.cpp test_log_service.cpp test_pair.cpp test_sync.cpp test_feeding_service.cpp test_power.cpp test_app.cpp
  wokwi/                    boot.scenario.yaml (exists) feed.scenario.yaml feed_all.scenario.yaml system_menu.scenario.yaml
assets/cats/render.py       + firmware outputs (white 130/88 PNG → C arrays)
.github/workflows/deploy.yml  firmware-hil2 runs every wokwi/*.scenario.yaml with wokwi-cli
```

---

## Task 1: Build scaffolding for the layered firmware

**Files:**
- Modify: `firmware/platformio.ini` (native env gets `build_src_filter = +<domain/> +<application/>`, `lib_deps = bblanchon/ArduinoJson@^7.2.0`, `test_build_src = yes`, `-DUNITY_INCLUDE_DOUBLE`; crowpanel/simulator get `-I src`; simulator adds `-DSIMULATOR=1` if not present), `firmware/include/lv_conf.h` (`LV_USE_LODEPNG 1`, `LV_USE_QRCODE 1`, `LV_FONT_MONTSERRAT_12/14/18/24/48 1`, `LV_USE_IMAGE 1`, `LV_CACHE_DEF_SIZE 0`), `firmware/test/test_domain/runner.cpp` (keep), new `firmware/test/test_application/runner.cpp`, `firmware/test/test_application/stubs.h` (empty for now)
- Create: `firmware/src/application/Events.h`

**Interfaces:**
- Produces: `namespace feedme2::application { enum class InputEvent : uint8_t { None, RotateCW, RotateCCW, Press, DoubleTap, LongPress, SwipeLeft, SwipeRight }; }` and the two Unity runners that every later task appends `RUN_TEST` lines to.

- [ ] **Step 1: Write the failing test** — `firmware/test/test_application/test_events.cpp`:

```cpp
#include <unity.h>
#include "application/Events.h"

void test_events_have_stable_names() {
    using feedme2::application::InputEvent;
    TEST_ASSERT_EQUAL_STRING("Press", feedme2::application::eventName(InputEvent::Press));
    TEST_ASSERT_EQUAL_STRING("RotateCW", feedme2::application::eventName(InputEvent::RotateCW));
    TEST_ASSERT_EQUAL_STRING("None", feedme2::application::eventName(InputEvent::None));
}
```

and `firmware/test/test_application/runner.cpp`:

```cpp
#include <unity.h>
void test_events_have_stable_names();
void setUp() {}
void tearDown() {}
int main() {
    UNITY_BEGIN();
    RUN_TEST(test_events_have_stable_names);
    return UNITY_END();
}
```

- [ ] **Step 2: Run** `cd firmware && pio test -e native` → FAIL (missing header).

- [ ] **Step 3: Write `firmware/src/application/Events.h`**

```cpp
#pragma once
#include <cstdint>

namespace feedme2::application {

// The knob grammar (spec §5.2). Touch is folded into the same events by
// CompositeInput: tap = Press, horizontal swipe = rotate.
enum class InputEvent : uint8_t { None, RotateCW, RotateCCW, Press, DoubleTap, LongPress, SwipeLeft, SwipeRight };

inline const char* eventName(InputEvent e) {
    switch (e) {
        case InputEvent::RotateCW: return "RotateCW";
        case InputEvent::RotateCCW: return "RotateCCW";
        case InputEvent::Press: return "Press";
        case InputEvent::DoubleTap: return "DoubleTap";
        case InputEvent::LongPress: return "LongPress";
        case InputEvent::SwipeLeft: return "SwipeLeft";
        case InputEvent::SwipeRight: return "SwipeRight";
        case InputEvent::None: break;
    }
    return "None";
}

}  // namespace feedme2::application
```

- [ ] **Step 4: platformio.ini** — in `[env:native]` set:

```ini
[env:native]
platform = native
test_framework = unity
test_build_src = yes
build_src_filter = +<domain/> +<application/>
build_flags = -std=gnu++17 -I src -I test -DUNITY_INCLUDE_DOUBLE -DFEEDME2_NATIVE=1
lib_deps = bblanchon/ArduinoJson@^7.2.0
```

(keep whatever Phase 0 already had that is compatible; ArduinoJson is header-only and builds on the host.) Confirm `[env:crowpanel]`/`[env:simulator]` have `-I src` (the common flags do).

- [ ] **Step 5: Run** `pio test -e native` → both runners green (`test_domain` 8 + `test_application` 1). Also `pio run -e crowpanel` and `pio run -e simulator` still build (nothing in `src/` references the new header yet).

- [ ] **Step 6: Commit**

```bash
git add firmware/platformio.ini firmware/include/lv_conf.h firmware/src/application/Events.h firmware/test/test_application/runner.cpp firmware/test/test_application/test_events.cpp firmware/test/test_application/stubs.h firmware/src/application/Version.h
git commit -m "feat(firmware): native env builds domain+application; input event enum; lvgl png and qr

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: `Units.h` pinned by `fixtures/unit-vectors.json`

**Files:**
- Create: `firmware/src/domain/Units.h`, `firmware/test/test_domain/test_units.cpp`, `firmware/test/fixtures.h` (reads a JSON file from `../fixtures/` relative to the firmware dir)
- Modify: `firmware/test/test_domain/runner.cpp`

**Interfaces:**
- Produces (`namespace feedme2::domain`): `enum class FoodUnit : uint8_t { Grams, Ounces, Cans }`, `enum class CanFraction : uint8_t { Quarter, Third, Half }`, `constexpr double kMgPerOz = 28349.5`, `constexpr int32_t kDefaultCanMg = 155922`, `struct StepSettings { int gramStep; int ozStepHundredths; CanFraction canFraction; int32_t canSizeMg; }`, `int32_t toMg(double value, FoodUnit, int32_t canSizeMg)`, `double fromMg(int32_t mg, FoodUnit, int32_t canSizeMg)`, `int32_t stepMg(FoodUnit, const StepSettings&)`, `int32_t snapToStep(int32_t mg, int32_t step)`, `std::string formatAmountAscii(int32_t mg, FoodUnit, int32_t canSizeMg)` ("40 g", "1.5 oz", "1/3 can", "1 1/2 can" — ASCII because Montserrat has no fraction glyphs), `const char* unitLabel(FoodUnit)`, `FoodUnit parseUnit(const char*)`, `CanFraction parseFraction(const char*)` ("1/4" → Quarter).

- [ ] **Step 1: Write `firmware/test/fixtures.h`**

```cpp
#pragma once
// Loads a cross-tier vector file from the repo's fixtures/ directory.
// Native tests run with cwd = firmware/, so the path is ../fixtures/.
#include <fstream>
#include <sstream>
#include <string>
#include <ArduinoJson.h>

inline std::string readFixture(const char* name) {
    std::ifstream in(std::string("../fixtures/") + name);
    std::stringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

inline JsonDocument loadFixture(const char* name) {
    JsonDocument doc;
    const auto err = deserializeJson(doc, readFixture(name));
    if (err) { doc.clear(); doc["__error"] = err.c_str(); }
    return doc;
}
```

- [ ] **Step 2: Failing test `firmware/test/test_domain/test_units.cpp`**

```cpp
#include <unity.h>
#include <cstring>
#include "domain/Units.h"
#include "fixtures.h"

using namespace feedme2::domain;

void test_units_fixture_loads() {
    auto doc = loadFixture("unit-vectors.json");
    TEST_ASSERT_FALSE_MESSAGE(doc["__error"].is<const char*>(), doc["__error"] | "parse error");
    TEST_ASSERT_EQUAL_DOUBLE(kMgPerOz, doc["mgPerOz"].as<double>());
    TEST_ASSERT_EQUAL_INT32(kDefaultCanMg, doc["defaultCanMg"].as<int32_t>());
}

void test_units_to_mg_matches_every_vector() {
    auto doc = loadFixture("unit-vectors.json");
    int n = 0;
    for (JsonObject v : doc["toMg"].as<JsonArray>()) {
        const int32_t got = toMg(v["value"].as<double>(), parseUnit(v["unit"]), v["canSizeMg"].as<int32_t>());
        TEST_ASSERT_EQUAL_INT32_MESSAGE(v["mg"].as<int32_t>(), got, v["unit"].as<const char*>());
        ++n;
    }
    TEST_ASSERT_GREATER_OR_EQUAL(6, n);
}

void test_units_step_matches_every_vector() {
    auto doc = loadFixture("unit-vectors.json");
    for (JsonObject v : doc["steps"].as<JsonArray>()) {
        StepSettings s{v["gramStep"].as<int>(), v["ozStepHundredths"].as<int>(), parseFraction(v["canFractionStep"]), v["canSizeMg"].as<int32_t>()};
        TEST_ASSERT_EQUAL_INT32_MESSAGE(v["stepMg"].as<int32_t>(), stepMg(parseUnit(v["unit"]), s), v["unit"].as<const char*>());
    }
}

void test_units_snap_and_format() {
    TEST_ASSERT_EQUAL_INT32(40000, snapToStep(42000, 5000));
    TEST_ASSERT_EQUAL_INT32(45000, snapToStep(43000, 5000));
    TEST_ASSERT_EQUAL_INT32(5000, snapToStep(100, 5000));
    TEST_ASSERT_EQUAL_STRING("40 g", formatAmountAscii(40000, FoodUnit::Grams, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("1.5 oz", formatAmountAscii(42524, FoodUnit::Ounces, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("1/3 can", formatAmountAscii(51974, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("1 1/2 can", formatAmountAscii(233883, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("1 can", formatAmountAscii(155922, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("0.27 can", formatAmountAscii(42255, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("52 g", formatAmountAscii(51974, FoodUnit::Grams, kDefaultCanMg).c_str());
}

void test_units_round_half_away_from_zero() {
    // 0.25 can of 155922 mg is 38980.5 → 38981 (std::lround), never 38980.
    TEST_ASSERT_EQUAL_INT32(38981, toMg(0.25, FoodUnit::Cans, kDefaultCanMg));
}
```

Register the five tests in `runner.cpp` (forward declarations + `RUN_TEST`).

- [ ] **Step 3: Run** `pio test -e native` → FAIL (missing `domain/Units.h`).

- [ ] **Step 4: Write `firmware/src/domain/Units.h`**

```cpp
#pragma once
// Mirror of shared/src/units.ts (spec §1.5). Both assert
// fixtures/unit-vectors.json; change them together. Values are IEEE
// doubles and rounding is half-away-from-zero (std::lround), matching
// Math.round on positive numbers.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>

namespace feedme2::domain {

enum class FoodUnit : uint8_t { Grams, Ounces, Cans };
enum class CanFraction : uint8_t { Quarter, Third, Half };

constexpr double kMgPerOz = 28349.5;
constexpr int32_t kDefaultCanMg = 155922;

struct StepSettings {
    int gramStep = 5;
    int ozStepHundredths = 25;
    CanFraction canFraction = CanFraction::Quarter;
    int32_t canSizeMg = kDefaultCanMg;
};

inline const char* unitLabel(FoodUnit u) {
    switch (u) { case FoodUnit::Grams: return "g"; case FoodUnit::Ounces: return "oz"; case FoodUnit::Cans: return "can"; }
    return "g";
}
inline FoodUnit parseUnit(const char* s) {
    if (s && std::strcmp(s, "oz") == 0) return FoodUnit::Ounces;
    if (s && std::strcmp(s, "can") == 0) return FoodUnit::Cans;
    return FoodUnit::Grams;
}
inline CanFraction parseFraction(const char* s) {
    if (s && std::strcmp(s, "1/3") == 0) return CanFraction::Third;
    if (s && std::strcmp(s, "1/2") == 0) return CanFraction::Half;
    return CanFraction::Quarter;
}
inline int fractionDenominator(CanFraction f) {
    switch (f) { case CanFraction::Quarter: return 4; case CanFraction::Third: return 3; case CanFraction::Half: return 2; }
    return 4;
}

inline double unitMg(FoodUnit u, int32_t canSizeMg) {
    switch (u) { case FoodUnit::Grams: return 1000.0; case FoodUnit::Ounces: return kMgPerOz; case FoodUnit::Cans: return static_cast<double>(canSizeMg); }
    return 1000.0;
}

inline int32_t toMg(double value, FoodUnit u, int32_t canSizeMg) {
    return static_cast<int32_t>(std::lround(value * unitMg(u, canSizeMg)));
}
inline double fromMg(int32_t mg, FoodUnit u, int32_t canSizeMg) {
    return static_cast<double>(mg) / unitMg(u, canSizeMg);
}

inline int32_t stepMg(FoodUnit u, const StepSettings& s) {
    switch (u) {
        case FoodUnit::Grams: return static_cast<int32_t>(std::lround(s.gramStep * 1000.0));
        case FoodUnit::Ounces: return static_cast<int32_t>(std::lround((s.ozStepHundredths / 100.0) * kMgPerOz));
        case FoodUnit::Cans: return static_cast<int32_t>(std::lround(static_cast<double>(s.canSizeMg) / fractionDenominator(s.canFraction)));
    }
    return 5000;
}

inline int32_t snapToStep(int32_t mg, int32_t step) {
    if (step <= 0) return mg;
    const int32_t n = static_cast<int32_t>(std::lround(static_cast<double>(mg) / step));
    return std::max(step, n * step);
}

namespace detail {
inline std::string trimZeros(std::string s) {
    if (s.find('.') == std::string::npos) return s;
    while (!s.empty() && s.back() == '0') s.pop_back();
    if (!s.empty() && s.back() == '.') s.pop_back();
    return s;
}
inline std::string fixed(double v, int digits) {
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.*f", digits, v);
    return trimZeros(buf);
}
// Same 0.02 tolerance as shared canParts; glyphs rendered as ASCII fractions.
inline const char* fractionText(double frac) {
    struct { double v; const char* t; } table[] = {{0.25, "1/4"}, {1.0 / 3, "1/3"}, {0.5, "1/2"}, {2.0 / 3, "2/3"}, {0.75, "3/4"}};
    for (auto& e : table) if (std::fabs(frac - e.v) < 0.02) return e.t;
    return nullptr;
}
}  // namespace detail

inline std::string formatAmountAscii(int32_t mg, FoodUnit u, int32_t canSizeMg) {
    const double v = fromMg(mg, u, canSizeMg);
    if (u == FoodUnit::Grams) return std::to_string(static_cast<long>(std::lround(v))) + " g";
    if (u == FoodUnit::Ounces) return detail::fixed(v, 2) + " oz";
    const long whole = static_cast<long>(std::floor(v + 1e-9));
    const double frac = v - static_cast<double>(whole);
    if (frac < 0.02) {
        if (whole == 0) return detail::fixed(v, 2) + " can";
        return std::to_string(whole) + " can";
    }
    const char* f = detail::fractionText(frac);
    if (f == nullptr) return detail::fixed(v, 2) + " can";
    if (whole == 0) return std::string(f) + " can";
    return std::to_string(whole) + " " + f + " can";
}

}  // namespace feedme2::domain
```

- [ ] **Step 5: Run** `pio test -e native` → green (14 cases).

- [ ] **Step 6: Commit**

```bash
git add firmware/src/domain/Units.h firmware/test/fixtures.h firmware/test/test_domain/test_units.cpp firmware/test/test_domain/runner.cpp firmware/src/application/Version.h
git commit -m "feat(firmware): units module pinned by fixtures/unit-vectors.json

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: `Hunger.h` and `Clock.h`

**Files:**
- Create: `firmware/src/domain/Hunger.h`, `firmware/src/domain/Clock.h`, `firmware/test/test_domain/test_hunger.cpp`, `firmware/test/test_domain/test_clock.cpp`
- Modify: `firmware/test/test_domain/runner.cpp`

**Interfaces:**
- Produces: `enum class HungerLevel : uint8_t { Fed, Content, Peckish, Hungry, VeryHungry, Starving }`, `constexpr int32_t kFedWindowSec = 900`, `struct HungerState { HungerLevel level; double ratio; double ageSec; }`, `HungerState hungerState(int64_t nowMs, const int64_t* lastFedAtMs /*nullptr = never*/, int32_t hungryAfterSec)`, `const char* levelName(HungerLevel)` ("fed", "content", …, "starving" — the TS names), `enum class LevelColor { Good, Warn, Danger }`, `LevelColor levelColor(HungerLevel)` (hungry → Warn, like shared); `class ClockModel { void setMonotonic(uint32_t ms); void syncFromServer(int64_t serverNowMs, uint32_t monotonicMs); bool isSynced() const; int64_t nowMs() const /* monotonic + offset; before sync: monotonic only */; int64_t offsetMs() const; }` with `kUnsyncedEpochMs = 0`.

- [ ] **Step 1: Failing `test_hunger.cpp`**

```cpp
#include <unity.h>
#include "domain/Hunger.h"
#include "fixtures.h"

using namespace feedme2::domain;

void test_hunger_fixture_every_case() {
    auto doc = loadFixture("hunger-vectors.json");
    TEST_ASSERT_EQUAL_INT32(kFedWindowSec, doc["fedWindowSec"].as<int32_t>());
    int n = 0;
    for (JsonObject c : doc["cases"].as<JsonArray>()) {
        const bool never = c["lastFedAtMs"].isNull();
        const int64_t last = never ? 0 : c["lastFedAtMs"].as<int64_t>();
        const auto s = hungerState(c["nowMs"].as<int64_t>(), never ? nullptr : &last, c["hungryAfterSec"].as<int32_t>());
        TEST_ASSERT_EQUAL_STRING_MESSAGE(c["level"].as<const char*>(), levelName(s.level), "level");
        if (c["ratio"].isNull()) TEST_ASSERT_TRUE(std::isinf(s.ratio));
        else TEST_ASSERT_DOUBLE_WITHIN(0.001, c["ratio"].as<double>(), s.ratio);
        if (!c["ageSec"].isNull()) TEST_ASSERT_DOUBLE_WITHIN(0.001, c["ageSec"].as<double>(), s.ageSec);
        ++n;
    }
    TEST_ASSERT_GREATER_OR_EQUAL(8, n);
}

void test_hunger_colours_and_degenerate_interval() {
    TEST_ASSERT_EQUAL(LevelColor::Good, levelColor(HungerLevel::Content));
    TEST_ASSERT_EQUAL(LevelColor::Warn, levelColor(HungerLevel::Hungry));
    TEST_ASSERT_EQUAL(LevelColor::Danger, levelColor(HungerLevel::Starving));
    const int64_t last = 1000;
    TEST_ASSERT_EQUAL(HungerLevel::Starving, hungerState(2000, &last, 0).level);
}
```

- [ ] **Step 2: Failing `test_clock.cpp`**

```cpp
#include <unity.h>
#include "domain/Clock.h"

using feedme2::domain::ClockModel;

void test_clock_unsynced_reports_monotonic_and_flag() {
    ClockModel c;
    c.setMonotonic(5000);
    TEST_ASSERT_FALSE(c.isSynced());
    TEST_ASSERT_EQUAL_INT64(5000, c.nowMs());
}

void test_clock_syncs_from_server_and_keeps_counting() {
    ClockModel c;
    c.setMonotonic(5000);
    c.syncFromServer(1'700'000'000'000LL, 5000);
    TEST_ASSERT_TRUE(c.isSynced());
    c.setMonotonic(8000);
    TEST_ASSERT_EQUAL_INT64(1'700'000'003'000LL, c.nowMs());
    // a second sync corrects drift without going backwards in a jump larger than the drift
    c.syncFromServer(1'700'000'004'000LL, 8000);
    TEST_ASSERT_EQUAL_INT64(1'700'000'004'000LL, c.nowMs());
}
```

- [ ] **Step 3: Run** → FAIL. Register the four tests in `runner.cpp`.

- [ ] **Step 4: Write `firmware/src/domain/Hunger.h`**

```cpp
#pragma once
// Mirror of shared/src/hunger.ts (spec §1.6), pinned by fixtures/hunger-vectors.json.
#include <cmath>
#include <cstdint>
#include <limits>

namespace feedme2::domain {

enum class HungerLevel : uint8_t { Fed, Content, Peckish, Hungry, VeryHungry, Starving };
enum class LevelColor : uint8_t { Good, Warn, Danger };

constexpr int32_t kFedWindowSec = 900;

struct HungerState {
    HungerLevel level;
    double ratio;   // age / hungryAfter; +inf when never fed
    double ageSec;  // clamped >= 0; +inf when never fed
};

inline HungerState hungerState(int64_t nowMs, const int64_t* lastFedAtMs, int32_t hungryAfterSec) {
    constexpr double inf = std::numeric_limits<double>::infinity();
    if (lastFedAtMs == nullptr) return {HungerLevel::Starving, inf, inf};
    // A feeding "from the future" (clock skew) counts as just now, never negative.
    const double ageSec = std::max(0.0, static_cast<double>(nowMs - *lastFedAtMs) / 1000.0);
    if (!(hungryAfterSec > 0)) return {HungerLevel::Starving, inf, ageSec};
    const double ratio = ageSec / hungryAfterSec;
    HungerLevel level;
    if (ageSec < kFedWindowSec) level = HungerLevel::Fed;
    else if (ratio < 0.5) level = HungerLevel::Content;
    else if (ratio < 0.75) level = HungerLevel::Peckish;
    else if (ratio < 1.0) level = HungerLevel::Hungry;
    else if (ratio < 1.5) level = HungerLevel::VeryHungry;
    else level = HungerLevel::Starving;
    return {level, ratio, ageSec};
}

inline const char* levelName(HungerLevel l) {
    switch (l) {
        case HungerLevel::Fed: return "fed";
        case HungerLevel::Content: return "content";
        case HungerLevel::Peckish: return "peckish";
        case HungerLevel::Hungry: return "hungry";
        case HungerLevel::VeryHungry: return "very_hungry";
        case HungerLevel::Starving: return "starving";
    }
    return "starving";
}

inline LevelColor levelColor(HungerLevel l) {
    switch (l) {
        case HungerLevel::Fed: case HungerLevel::Content: return LevelColor::Good;
        case HungerLevel::Peckish: case HungerLevel::Hungry: return LevelColor::Warn;
        case HungerLevel::VeryHungry: case HungerLevel::Starving: return LevelColor::Danger;
    }
    return LevelColor::Danger;
}

}  // namespace feedme2::domain
```

- [ ] **Step 5: Write `firmware/src/domain/Clock.h`**

```cpp
#pragma once
// Wall-clock model (spec §5.3): the device trusts the server's `now`
// over its RTC. Until the first sync, nowMs() is the monotonic counter
// so an unsynced timestamp is small and obviously wrong — the server
// clamps it (Phase 2a) and the UI shows "—" instead of "fed 56 years ago".
#include <cstdint>

namespace feedme2::domain {

class ClockModel {
public:
    void setMonotonic(uint32_t ms) { monotonicMs_ = ms; }
    void syncFromServer(int64_t serverNowMs, uint32_t monotonicMs) {
        monotonicMs_ = monotonicMs;
        offsetMs_ = serverNowMs - static_cast<int64_t>(monotonicMs);
        synced_ = true;
    }
    bool isSynced() const { return synced_; }
    int64_t offsetMs() const { return offsetMs_; }
    int64_t nowMs() const { return synced_ ? offsetMs_ + static_cast<int64_t>(monotonicMs_) : static_cast<int64_t>(monotonicMs_); }

private:
    uint32_t monotonicMs_ = 0;
    int64_t offsetMs_ = 0;
    bool synced_ = false;
};

}  // namespace feedme2::domain
```

- [ ] **Step 6: Run** `pio test -e native` → green (18 cases). Commit:

```bash
git add firmware/src/domain/Hunger.h firmware/src/domain/Clock.h firmware/test/test_domain/test_hunger.cpp firmware/test/test_domain/test_clock.cpp firmware/test/test_domain/runner.cpp firmware/src/application/Version.h
git commit -m "feat(firmware): hunger levels pinned by fixtures; server-corrected clock model

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
## Task 4: Domain state — `DeviceState.h`, `CatRoster.h`, `FeedFlow.h`, `FeedingQueue.h`, `Router.h`, `LongPressArc.h`

**Files:**
- Create: `firmware/src/domain/DeviceState.h`, `CatRoster.h`, `FeedFlow.h`, `FeedingQueue.h`, `Router.h`, `LongPressArc.h`
- Create: `firmware/test/test_domain/test_roster.cpp`, `test_feedflow.cpp`, `test_queue.cpp`, `test_router.cpp`, `test_arc.cpp`
- Modify: `firmware/test/test_domain/runner.cpp`

**Interfaces:**
- `DeviceState.h`: `struct HouseSettings { FoodUnit foodUnit; int32_t canSizeMg; CanFraction canFractionStep; int gramStep; int ozStepHundredths; int32_t hungryAfterSecDefault; int32_t sleepTimeoutSec; int32_t syncIntervalSec; std::string timezone; }`, `struct CatState { std::string id, name; uint32_t colorRgb; std::string avatarPose; int32_t hungryAfterSec; int sortOrder; bool hasDefault; int32_t defaultAmountMg; FoodUnit defaultUnit; std::string defaultValue; bool hasLastFed; int64_t lastFedAtMs; }`, `struct DeviceState { std::string houseId, houseName; int tzOffsetMin; HouseSettings settings; std::string deviceId, deviceName; std::vector<CatState> cats /*sorted by sortOrder,id*/; int64_t nowMs; }`, `StepSettings stepSettingsOf(const HouseSettings&)`.
- `CatRoster.h`: `class CatRoster { void setState(const DeviceState&); size_t count() const /*cats + All when ≥2*/; bool hasAll() const; void rotate(int delta) /*wrap*/; bool isAllSelected() const; const CatState* selected() const /*nullptr when All or empty*/; size_t index() const; void selectById(const std::string&); }`.
- `FeedFlow.h`: `enum class Phase { Idle, Amount, Fed }`, `enum class Scale { Half, One, OneAndHalf }`, `struct FeedingDraft { std::string id, catId; int64_t fedAtMs; int32_t amountMg; FoodUnit unit; std::string enteredValue; }`, `class FeedFlow { void begin(const DeviceState&, const CatState* cat /*nullptr = All*/, int64_t nowMs); Phase phase() const; bool isAll() const; int32_t amountMg() const; Scale scale() const; void rotate(int delta); std::string amountText() const /* "40 g" or "1 x" */; std::vector<FeedingDraft> confirm(const std::function<std::string()>& newId, int64_t nowMs); void cancel(); void finishFed(); }`, `constexpr int32_t kFallbackMg = 40000`, `constexpr int32_t kMaxAmountMg = 5'000'000`.
- `FeedingQueue.h`: `class FeedingQueue { void push(FeedingDraft); size_t size() const; const std::vector<FeedingDraft>& items() const; std::vector<FeedingDraft> head(size_t n) const; void removeIds(const std::vector<std::string>&); bool empty() const; static constexpr size_t kCap = 200; }` (drop-oldest).
- `Router.h`: `enum class ScreenId { Boot, Pair, Idle, Amount, Fed, History, System, WifiList, About, UnpairConfirm }`, `class Router { ScreenId current() const; void push(ScreenId); bool pop(); void replaceRoot(ScreenId); bool atRoot() const; }`.
- `LongPressArc.h`: `class LongPressArc { explicit LongPressArc(uint32_t holdMs = 600); void update(uint32_t nowMs, bool held); int percent() const; bool charging() const; }`.

- [ ] **Step 1: Failing tests** (each file registers in `runner.cpp`):

`test_roster.cpp`:
```cpp
#include <unity.h>
#include "domain/CatRoster.h"
using namespace feedme2::domain;

static DeviceState twoCats() {
    DeviceState s;
    CatState a; a.id = "a"; a.name = "Mochi"; a.sortOrder = 1;
    CatState b; b.id = "b"; b.name = "Luna"; b.sortOrder = 0;
    s.cats = {a, b};
    return s;
}

void test_roster_sorts_and_adds_all_for_two_cats() {
    CatRoster r; r.setState(twoCats());
    TEST_ASSERT_EQUAL_UINT32(3, r.count());
    TEST_ASSERT_TRUE(r.hasAll());
    TEST_ASSERT_EQUAL_STRING("Luna", r.selected()->name.c_str());
    r.rotate(1); TEST_ASSERT_EQUAL_STRING("Mochi", r.selected()->name.c_str());
    r.rotate(1); TEST_ASSERT_TRUE(r.isAllSelected()); TEST_ASSERT_NULL(r.selected());
    r.rotate(1); TEST_ASSERT_EQUAL_STRING("Luna", r.selected()->name.c_str());
    r.rotate(-1); TEST_ASSERT_TRUE(r.isAllSelected());
}

void test_roster_single_cat_has_no_all_and_keeps_selection_across_state_updates() {
    CatRoster r;
    DeviceState one = twoCats(); one.cats.pop_back();
    r.setState(one);
    TEST_ASSERT_EQUAL_UINT32(1, r.count());
    TEST_ASSERT_FALSE(r.hasAll());
    r.rotate(5); TEST_ASSERT_EQUAL_STRING("Mochi", r.selected()->name.c_str());
    DeviceState two = twoCats();
    r.setState(two);
    TEST_ASSERT_EQUAL_STRING("Mochi", r.selected()->name.c_str());  // same id re-selected, not index 0
    r.selectById("zzz"); TEST_ASSERT_EQUAL_STRING("Mochi", r.selected()->name.c_str());
}
```

`test_feedflow.cpp`:
```cpp
#include <unity.h>
#include "domain/FeedFlow.h"
using namespace feedme2::domain;

static DeviceState house() {
    DeviceState s;
    s.settings.foodUnit = FoodUnit::Grams; s.settings.gramStep = 5; s.settings.canSizeMg = kDefaultCanMg; s.settings.canFractionStep = CanFraction::Quarter; s.settings.ozStepHundredths = 25;
    CatState a; a.id = "a"; a.name = "Mochi"; a.hasDefault = true; a.defaultAmountMg = 40000; a.defaultUnit = FoodUnit::Grams; a.defaultValue = "40";
    CatState b; b.id = "b"; b.name = "Luna"; b.hasDefault = false;
    s.cats = {a, b};
    return s;
}
static std::string nextId() { static int n = 0; return "id-" + std::to_string(++n); }

void test_feedflow_single_cat_steps_in_house_unit_and_confirms_one_draft() {
    auto s = house();
    FeedFlow f; f.begin(s, &s.cats[0], 1000);
    TEST_ASSERT_EQUAL(Phase::Amount, f.phase());
    TEST_ASSERT_EQUAL_INT32(40000, f.amountMg());
    f.rotate(1); TEST_ASSERT_EQUAL_INT32(45000, f.amountMg());
    f.rotate(-3); TEST_ASSERT_EQUAL_INT32(30000, f.amountMg());
    TEST_ASSERT_EQUAL_STRING("30 g", f.amountText().c_str());
    auto drafts = f.confirm(nextId, 2000);
    TEST_ASSERT_EQUAL(Phase::Fed, f.phase());
    TEST_ASSERT_EQUAL_UINT32(1, drafts.size());
    TEST_ASSERT_EQUAL_STRING("a", drafts[0].catId.c_str());
    TEST_ASSERT_EQUAL_INT32(30000, drafts[0].amountMg);
    TEST_ASSERT_EQUAL_STRING("30", drafts[0].enteredValue.c_str());
    TEST_ASSERT_EQUAL_INT64(2000, drafts[0].fedAtMs);
    f.finishFed(); TEST_ASSERT_EQUAL(Phase::Idle, f.phase());
}

void test_feedflow_cat_without_default_starts_at_fallback_and_never_below_one_step() {
    auto s = house();
    FeedFlow f; f.begin(s, &s.cats[1], 1000);
    TEST_ASSERT_EQUAL_INT32(kFallbackMg, f.amountMg());
    for (int i = 0; i < 100; ++i) f.rotate(-1);
    TEST_ASSERT_EQUAL_INT32(5000, f.amountMg());
    for (int i = 0; i < 100000; ++i) f.rotate(1);
    TEST_ASSERT_TRUE(f.amountMg() <= kMaxAmountMg);
}

void test_feedflow_all_cats_uses_scale_and_each_cats_default() {
    auto s = house();
    FeedFlow f; f.begin(s, nullptr, 1000);
    TEST_ASSERT_TRUE(f.isAll());
    TEST_ASSERT_EQUAL(Scale::One, f.scale());
    TEST_ASSERT_EQUAL_STRING("1 x", f.amountText().c_str());
    f.rotate(1); TEST_ASSERT_EQUAL(Scale::OneAndHalf, f.scale());
    f.rotate(1); TEST_ASSERT_EQUAL(Scale::OneAndHalf, f.scale());  // clamps
    f.rotate(-2); TEST_ASSERT_EQUAL(Scale::Half, f.scale());
    auto drafts = f.confirm(nextId, 3000);
    TEST_ASSERT_EQUAL_UINT32(2, drafts.size());
    TEST_ASSERT_EQUAL_INT32(20000, drafts[0].amountMg);   // Mochi 40 g × ½
    TEST_ASSERT_EQUAL_INT32(20000, drafts[1].amountMg);   // Luna: fallback 40 g × ½ (Review Focus 5)
    TEST_ASSERT_EQUAL_STRING("20", drafts[1].enteredValue.c_str());
}

void test_feedflow_can_unit_formats_fraction_steps() {
    auto s = house(); s.settings.foodUnit = FoodUnit::Cans; s.settings.canFractionStep = CanFraction::Third;
    s.cats[0].defaultAmountMg = 51974; s.cats[0].defaultUnit = FoodUnit::Cans; s.cats[0].defaultValue = "1/3";
    FeedFlow f; f.begin(s, &s.cats[0], 0);
    TEST_ASSERT_EQUAL_STRING("1/3 can", f.amountText().c_str());
    f.rotate(2);
    TEST_ASSERT_EQUAL_STRING("1 can", f.amountText().c_str());
    auto d = f.confirm(nextId, 1);
    TEST_ASSERT_EQUAL_STRING("1", d[0].enteredValue.c_str());
    TEST_ASSERT_EQUAL(FoodUnit::Cans, d[0].unit);
}

void test_feedflow_cancel_returns_to_idle_without_drafts() {
    auto s = house();
    FeedFlow f; f.begin(s, &s.cats[0], 0);
    f.cancel();
    TEST_ASSERT_EQUAL(Phase::Idle, f.phase());
}
```

`test_queue.cpp`:
```cpp
#include <unity.h>
#include "domain/FeedingQueue.h"
using namespace feedme2::domain;

static FeedingDraft d(const char* id) { FeedingDraft x; x.id = id; x.catId = "c"; x.amountMg = 1000; x.unit = FoodUnit::Grams; x.enteredValue = "1"; x.fedAtMs = 1; return x; }

void test_queue_fifo_head_and_remove_by_id() {
    FeedingQueue q;
    q.push(d("a")); q.push(d("b")); q.push(d("c"));
    auto h = q.head(2);
    TEST_ASSERT_EQUAL_UINT32(2, h.size());
    TEST_ASSERT_EQUAL_STRING("a", h[0].id.c_str());
    q.removeIds({"a", "zzz"});
    TEST_ASSERT_EQUAL_UINT32(2, q.size());
    TEST_ASSERT_EQUAL_STRING("b", q.items()[0].id.c_str());
}

void test_queue_drops_oldest_past_cap() {
    FeedingQueue q;
    for (size_t i = 0; i < FeedingQueue::kCap + 5; ++i) q.push(d(std::to_string(i).c_str()));
    TEST_ASSERT_EQUAL_UINT32(FeedingQueue::kCap, q.size());
    TEST_ASSERT_EQUAL_STRING("5", q.items()[0].id.c_str());
}
```

`test_router.cpp`:
```cpp
#include <unity.h>
#include "domain/Router.h"
using namespace feedme2::domain;

void test_router_stack() {
    Router r;
    TEST_ASSERT_EQUAL(ScreenId::Boot, r.current());
    r.replaceRoot(ScreenId::Idle);
    TEST_ASSERT_TRUE(r.atRoot());
    r.push(ScreenId::System); r.push(ScreenId::WifiList);
    TEST_ASSERT_EQUAL(ScreenId::WifiList, r.current());
    TEST_ASSERT_TRUE(r.pop()); TEST_ASSERT_EQUAL(ScreenId::System, r.current());
    TEST_ASSERT_TRUE(r.pop()); TEST_ASSERT_FALSE(r.pop());
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.current());
}
```

`test_arc.cpp`:
```cpp
#include <unity.h>
#include "domain/LongPressArc.h"
using feedme2::domain::LongPressArc;

void test_arc_charges_over_hold_and_resets_on_release() {
    LongPressArc a(600);
    a.update(0, true);   TEST_ASSERT_EQUAL_INT(0, a.percent()); TEST_ASSERT_TRUE(a.charging());
    a.update(300, true); TEST_ASSERT_EQUAL_INT(50, a.percent());
    a.update(900, true); TEST_ASSERT_EQUAL_INT(100, a.percent());
    a.update(950, false); TEST_ASSERT_EQUAL_INT(0, a.percent()); TEST_ASSERT_FALSE(a.charging());
}
```

- [ ] **Step 2: Run** `pio test -e native` → FAIL (missing headers).

- [ ] **Step 3: Write the headers**

`DeviceState.h`:
```cpp
#pragma once
#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>
#include "domain/Units.h"

namespace feedme2::domain {

struct HouseSettings {
    FoodUnit foodUnit = FoodUnit::Grams;
    int32_t canSizeMg = kDefaultCanMg;
    CanFraction canFractionStep = CanFraction::Quarter;
    int gramStep = 5;
    int ozStepHundredths = 25;
    int32_t hungryAfterSecDefault = 18000;
    int32_t sleepTimeoutSec = 300;
    int32_t syncIntervalSec = 21600;
    std::string timezone = "UTC";
};

struct CatState {
    std::string id, name;
    uint32_t colorRgb = 0x4CAF50;
    std::string avatarPose = "C2";
    int32_t hungryAfterSec = 18000;
    int sortOrder = 0;
    bool hasDefault = false;
    int32_t defaultAmountMg = 0;
    FoodUnit defaultUnit = FoodUnit::Grams;
    std::string defaultValue;
    bool hasLastFed = false;
    int64_t lastFedAtMs = 0;
};

struct DeviceState {
    std::string houseId, houseName;
    int tzOffsetMin = 0;
    HouseSettings settings;
    std::string deviceId, deviceName;
    std::vector<CatState> cats;
    int64_t nowMs = 0;

    void sortCats() {
        std::stable_sort(cats.begin(), cats.end(), [](const CatState& a, const CatState& b) {
            return a.sortOrder != b.sortOrder ? a.sortOrder < b.sortOrder : a.id < b.id;
        });
    }
};

inline StepSettings stepSettingsOf(const HouseSettings& h) {
    return StepSettings{h.gramStep, h.ozStepHundredths, h.canFractionStep, h.canSizeMg};
}

}  // namespace feedme2::domain
```

`CatRoster.h`:
```cpp
#pragma once
// Knob selection over the cats plus the "All cats" entry (spec §1.2 step 2).
#include <string>
#include "domain/DeviceState.h"

namespace feedme2::domain {

class CatRoster {
public:
    void setState(const DeviceState& s) {
        std::string keepId = selectedId();
        const bool keepAll = isAllSelected();
        cats_ = s.cats;
        std::stable_sort(cats_.begin(), cats_.end(), [](const CatState& a, const CatState& b) { return a.sortOrder != b.sortOrder ? a.sortOrder < b.sortOrder : a.id < b.id; });
        index_ = 0;
        if (keepAll && hasAll()) index_ = cats_.size();
        else if (!keepId.empty()) selectById(keepId);
    }
    size_t count() const { return cats_.size() + (hasAll() ? 1 : 0); }
    bool hasAll() const { return cats_.size() >= 2; }
    void rotate(int delta) {
        const size_t n = count();
        if (n == 0) return;
        const long i = (static_cast<long>(index_) + delta) % static_cast<long>(n);
        index_ = static_cast<size_t>(i < 0 ? i + static_cast<long>(n) : i);
    }
    bool isAllSelected() const { return hasAll() && index_ == cats_.size(); }
    const CatState* selected() const { return (cats_.empty() || isAllSelected()) ? nullptr : &cats_[index_]; }
    size_t index() const { return index_; }
    void selectById(const std::string& id) {
        for (size_t i = 0; i < cats_.size(); ++i) if (cats_[i].id == id) { index_ = i; return; }
    }
    const std::vector<CatState>& cats() const { return cats_; }

private:
    std::string selectedId() const { const auto* c = selected(); return c ? c->id : std::string(); }
    std::vector<CatState> cats_;
    size_t index_ = 0;
};

}  // namespace feedme2::domain
```

`FeedFlow.h`:
```cpp
#pragma once
// The feeding state machine (spec §1.2 step 3, §5.2): Idle → Amount → Fed.
// Single cat: the knob steps the amount in the house unit. "All cats":
// the knob picks a scale and each cat gets its own default × scale.
#include <functional>
#include <string>
#include <vector>
#include "domain/DeviceState.h"
#include "domain/Units.h"

namespace feedme2::domain {

enum class Phase : uint8_t { Idle, Amount, Fed };
enum class Scale : uint8_t { Half, One, OneAndHalf };

constexpr int32_t kFallbackMg = 40000;      // a cat that was never fed: 40 g
constexpr int32_t kMaxAmountMg = 5'000'000;  // server cap (shared amountMg max)

struct FeedingDraft {
    std::string id, catId;
    int64_t fedAtMs = 0;
    int32_t amountMg = 0;
    FoodUnit unit = FoodUnit::Grams;
    std::string enteredValue;
};

class FeedFlow {
public:
    void begin(const DeviceState& s, const CatState* cat, int64_t nowMs) {
        settings_ = s.settings;
        cats_ = s.cats;
        all_ = (cat == nullptr);
        scale_ = Scale::One;
        catId_ = all_ ? "" : cat->id;
        amountMg_ = all_ ? 0 : defaultFor(*cat);
        phase_ = Phase::Amount;
        (void)nowMs;
    }
    Phase phase() const { return phase_; }
    bool isAll() const { return all_; }
    int32_t amountMg() const { return amountMg_; }
    Scale scale() const { return scale_; }

    void rotate(int delta) {
        if (phase_ != Phase::Amount) return;
        if (all_) {
            int i = static_cast<int>(scale_) + delta;
            i = std::max(0, std::min(2, i));
            scale_ = static_cast<Scale>(i);
            return;
        }
        const int32_t step = stepMg(settings_.foodUnit, stepSettingsOf(settings_));
        int64_t next = static_cast<int64_t>(amountMg_) + static_cast<int64_t>(delta) * step;
        next = std::min<int64_t>(next, kMaxAmountMg);
        amountMg_ = snapToStep(static_cast<int32_t>(std::max<int64_t>(next, step)), step);
    }

    std::string amountText() const {
        if (all_) {
            switch (scale_) { case Scale::Half: return "1/2 x"; case Scale::One: return "1 x"; case Scale::OneAndHalf: return "1 1/2 x"; }
        }
        return formatAmountAscii(amountMg_, settings_.foodUnit, settings_.canSizeMg);
    }

    std::vector<FeedingDraft> confirm(const std::function<std::string()>& newId, int64_t nowMs) {
        std::vector<FeedingDraft> out;
        if (phase_ != Phase::Amount) return out;
        if (all_) {
            for (const auto& c : cats_) out.push_back(draft(c.id, scaled(defaultFor(c)), newId(), nowMs));
        } else {
            out.push_back(draft(catId_, amountMg_, newId(), nowMs));
        }
        phase_ = Phase::Fed;
        return out;
    }
    void cancel() { phase_ = Phase::Idle; }
    void finishFed() { phase_ = Phase::Idle; }

private:
    int32_t defaultFor(const CatState& c) const {
        // The server already converted the cat's default into the house unit's mg; use it as is.
        return c.hasDefault && c.defaultAmountMg > 0 ? c.defaultAmountMg : kFallbackMg;
    }
    int32_t scaled(int32_t mg) const {
        switch (scale_) { case Scale::Half: return std::max<int32_t>(1, mg / 2); case Scale::One: return mg; case Scale::OneAndHalf: return std::min<int32_t>(kMaxAmountMg, mg + mg / 2); }
        return mg;
    }
    FeedingDraft draft(const std::string& catId, int32_t mg, std::string id, int64_t nowMs) const {
        FeedingDraft d;
        d.id = std::move(id); d.catId = catId; d.fedAtMs = nowMs; d.amountMg = mg; d.unit = settings_.foodUnit;
        // enteredValue is what the knob showed, without the unit word.
        std::string t = formatAmountAscii(mg, settings_.foodUnit, settings_.canSizeMg);
        d.enteredValue = t.substr(0, t.rfind(' '));
        return d;
    }

    HouseSettings settings_;
    std::vector<CatState> cats_;
    bool all_ = false;
    Scale scale_ = Scale::One;
    std::string catId_;
    int32_t amountMg_ = 0;
    Phase phase_ = Phase::Idle;
};

}  // namespace feedme2::domain
```

`FeedingQueue.h`:
```cpp
#pragma once
#include <algorithm>
#include <string>
#include <vector>
#include "domain/FeedFlow.h"

namespace feedme2::domain {

// Offline feedings waiting for a sync round (spec §1.2 step 6). Capped so
// a device that never reconnects cannot exhaust LittleFS; the oldest go first.
class FeedingQueue {
public:
    static constexpr size_t kCap = 200;
    void push(FeedingDraft d) { items_.push_back(std::move(d)); if (items_.size() > kCap) items_.erase(items_.begin(), items_.begin() + (items_.size() - kCap)); }
    size_t size() const { return items_.size(); }
    bool empty() const { return items_.empty(); }
    const std::vector<FeedingDraft>& items() const { return items_; }
    std::vector<FeedingDraft> head(size_t n) const { return {items_.begin(), items_.begin() + std::min(n, items_.size())}; }
    void removeIds(const std::vector<std::string>& ids) {
        items_.erase(std::remove_if(items_.begin(), items_.end(), [&](const FeedingDraft& d) { return std::find(ids.begin(), ids.end(), d.id) != ids.end(); }), items_.end());
    }
    void replace(std::vector<FeedingDraft> items) { items_ = std::move(items); }

private:
    std::vector<FeedingDraft> items_;
};

}  // namespace feedme2::domain
```

`Router.h`:
```cpp
#pragma once
#include <vector>

namespace feedme2::domain {

enum class ScreenId : uint8_t { Boot, Pair, Idle, Amount, Fed, History, System, WifiList, About, UnpairConfirm };

class Router {
public:
    ScreenId current() const { return stack_.back(); }
    void push(ScreenId s) { stack_.push_back(s); }
    bool pop() { if (stack_.size() <= 1) return false; stack_.pop_back(); return true; }
    void replaceRoot(ScreenId s) { stack_.assign(1, s); }
    bool atRoot() const { return stack_.size() == 1; }

private:
    std::vector<ScreenId> stack_{ScreenId::Boot};
};

inline const char* screenName(ScreenId s) {
    switch (s) {
        case ScreenId::Boot: return "boot"; case ScreenId::Pair: return "pair"; case ScreenId::Idle: return "idle";
        case ScreenId::Amount: return "amount"; case ScreenId::Fed: return "fed"; case ScreenId::History: return "history";
        case ScreenId::System: return "system"; case ScreenId::WifiList: return "wifi"; case ScreenId::About: return "about";
        case ScreenId::UnpairConfirm: return "unpair";
    }
    return "?";
}

}  // namespace feedme2::domain
```

`LongPressArc.h`:
```cpp
#pragma once
#include <cstdint>

namespace feedme2::domain {

// Hold-to-confirm progress (spec §5.2 "LongPress 600 ms, perimeter arc").
// Cosmetic: the input adapter fires the real LongPress event.
class LongPressArc {
public:
    explicit LongPressArc(uint32_t holdMs = 600) : holdMs_(holdMs) {}
    void update(uint32_t nowMs, bool held) {
        if (!held) { charging_ = false; percent_ = 0; return; }
        if (!charging_) { charging_ = true; startMs_ = nowMs; }
        const uint32_t elapsed = nowMs - startMs_;
        percent_ = elapsed >= holdMs_ ? 100 : static_cast<int>(elapsed * 100 / holdMs_);
    }
    int percent() const { return percent_; }
    bool charging() const { return charging_; }

private:
    uint32_t holdMs_;
    uint32_t startMs_ = 0;
    bool charging_ = false;
    int percent_ = 0;
};

}  // namespace feedme2::domain
```

- [ ] **Step 4: Run** `pio test -e native` → green (29 cases). Commit:

```bash
git add firmware/src/domain/DeviceState.h firmware/src/domain/CatRoster.h firmware/src/domain/FeedFlow.h firmware/src/domain/FeedingQueue.h firmware/src/domain/Router.h firmware/src/domain/LongPressArc.h firmware/test/test_domain/test_roster.cpp firmware/test/test_domain/test_feedflow.cpp firmware/test/test_domain/test_queue.cpp firmware/test/test_domain/test_router.cpp firmware/test/test_domain/test_arc.cpp firmware/test/test_domain/runner.cpp firmware/src/application/Version.h
git commit -m "feat(firmware): device state, cat roster, feed flow, queue, router and arc models

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: Ports, stubs and the JSON codecs

**Files:**
- Create: `firmware/src/ports/IClock.h`, `IRandom.h`, `IInput.h`, `INetwork.h`, `IStorage.h`, `IFileQueue.h`, `IPower.h`, `ILogSink.h`
- Create: `firmware/src/application/StateCodec.h`, `StateCodec.cpp`, `QueueCodec.h`, `QueueCodec.cpp`
- Create: `firmware/test/test_application/stubs.h` (replace the empty file), `firmware/test/test_application/test_state_codec.cpp`, `test_queue_codec.cpp`
- Modify: `firmware/test/test_application/runner.cpp`

**Interfaces:**
- `IClock`: `virtual uint32_t monotonicMs() = 0;` (ms since boot). `IRandom`: `virtual std::string uuid() = 0;` (36-char lowercase v4), `virtual uint32_t next() = 0;`.
- `IInput`: `virtual application::InputEvent poll() = 0; virtual bool isHeld() const = 0;`.
- `INetwork`: `struct NetResult { enum class Kind : uint8_t { Ok, NotModified, Transient, Unauthorized, Permanent }; Kind kind; int status; std::string body; std::string etag; bool ok() const; };` and `virtual bool isOnline() const; virtual NetResult pairStart(const std::string& deviceId, const std::string& hwModel, const std::string& fw); virtual NetResult pairCheck(const std::string& deviceId); virtual NetResult getState(const std::string& ifNoneMatch); virtual NetResult postFeedings(const std::string& jsonArray); virtual NetResult postLogs(const std::string& jsonArray); virtual NetResult postHeartbeat(const std::string& jsonBody); virtual void setToken(const std::string&);`. Mapping rule (documented in the header): 2xx → Ok, 304 → NotModified, 401 → Unauthorized, other 4xx → Permanent, 5xx/408/429/transport → Transient.
- `IStorage` (NVS blobs): `bool read(const char* key, std::string& out); bool write(const char* key, const std::string&); bool erase(const char* key);` keys: `token`, `wifi`, `state` (last state JSON), `etag`, `name`.
- `IFileQueue` (LittleFS JSONL): `bool appendLine(const char* file, const std::string& line); bool readLines(const char* file, std::vector<std::string>& out); bool rewrite(const char* file, const std::vector<std::string>& lines);` files `/feedings.jsonl`, `/logs.jsonl`.
- `IPower`: `virtual void setBacklight(uint8_t percent) = 0; virtual void displaySleep(bool) = 0; virtual void lightSleep(uint32_t maxMs) = 0; virtual void ledRing(uint32_t rgb, uint8_t brightness) = 0;`.
- `ILogSink`: `virtual void write(const char* level, const char* msg, const char* dataJsonOrNull) = 0;`.
- `StateCodec`: `bool decodeState(const std::string& json, domain::DeviceState& out, std::string& err)` (accepts the shared `DeviceState` shape; unknown keys ignored; `hungryAfterSec` etc. validated > 0), `std::string encodeHeartbeat(const char* fw, uint32_t uptimeSec, const char* resetReason, uint32_t freeHeap, int batteryPct /* -1 = none */)`.
- `QueueCodec`: `std::string encodeDraft(const domain::FeedingDraft&)` (one JSON object matching `DeviceFeedingCreate`: `id, catId, fedAt, amountMg, enteredUnit, enteredValue`), `bool decodeDraft(const std::string&, domain::FeedingDraft&)`, `std::string encodeDraftsArray(const std::vector<domain::FeedingDraft>&)`, `std::vector<std::string> decodeAcceptedIds(const std::string& responseJson, int64_t* serverNow /*nullable*/)`, `std::string encodeLogEntry(int64_t ts, const char* level, const char* msg, const char* dataJson)`, `std::string joinArray(const std::vector<std::string>& jsonObjects)`.

- [ ] **Step 1: Failing `test_state_codec.cpp`**

```cpp
#include <unity.h>
#include "application/StateCodec.h"
#include "fixtures.h"
using namespace feedme2;

void test_state_codec_parses_the_sample_fixture() {
    domain::DeviceState s; std::string err;
    TEST_ASSERT_TRUE_MESSAGE(application::decodeState(readFixture("device-state.sample.json"), s, err), err.c_str());
    TEST_ASSERT_EQUAL_STRING("Mochi House", s.houseName.c_str());
    TEST_ASSERT_EQUAL_INT(-240, s.tzOffsetMin);
    TEST_ASSERT_EQUAL(domain::FoodUnit::Grams, s.settings.foodUnit);
    TEST_ASSERT_EQUAL_INT32(155922, s.settings.canSizeMg);
    TEST_ASSERT_EQUAL(domain::CanFraction::Quarter, s.settings.canFractionStep);
    TEST_ASSERT_EQUAL_INT32(300, s.settings.sleepTimeoutSec);
    TEST_ASSERT_EQUAL_STRING("Kitchen", s.deviceName.c_str());
    TEST_ASSERT_EQUAL_UINT32(2, s.cats.size());
    TEST_ASSERT_EQUAL_STRING("Mochi", s.cats[0].name.c_str());
    TEST_ASSERT_EQUAL_HEX32(0x4CAF50, s.cats[0].colorRgb);
    TEST_ASSERT_TRUE(s.cats[0].hasDefault); TEST_ASSERT_EQUAL_INT32(40000, s.cats[0].defaultAmountMg);
    TEST_ASSERT_TRUE(s.cats[0].hasLastFed); TEST_ASSERT_EQUAL_INT64(1700000000000LL, s.cats[0].lastFedAtMs);
    TEST_ASSERT_FALSE(s.cats[1].hasDefault); TEST_ASSERT_FALSE(s.cats[1].hasLastFed);
    TEST_ASSERT_EQUAL_INT64(1700003600000LL, s.nowMs);
}

void test_state_codec_rejects_garbage_and_missing_cats() {
    domain::DeviceState s; std::string err;
    TEST_ASSERT_FALSE(application::decodeState("{not json", s, err));
    TEST_ASSERT_FALSE(application::decodeState("{\"house\":{}}", s, err));
    TEST_ASSERT_TRUE(err.size() > 0);
}

void test_heartbeat_encoding() {
    const auto j = application::encodeHeartbeat("0.2.0", 120, "POWERON", 150000, -1);
    JsonDocument d; TEST_ASSERT_FALSE(deserializeJson(d, j));
    TEST_ASSERT_EQUAL_STRING("0.2.0", d["fwVersion"]);
    TEST_ASSERT_EQUAL_UINT32(120, d["uptimeSec"].as<uint32_t>());
    TEST_ASSERT_FALSE(d["batteryPct"].is<int>());
    TEST_ASSERT_TRUE(deserializeJson(d, application::encodeHeartbeat("0.2.0", 1, "SW", 1, 87)) == DeserializationError::Ok);
    TEST_ASSERT_EQUAL_INT(87, d["batteryPct"].as<int>());
}
```

- [ ] **Step 2: Failing `test_queue_codec.cpp`**

```cpp
#include <unity.h>
#include "application/QueueCodec.h"
using namespace feedme2;

void test_draft_round_trip_and_array() {
    domain::FeedingDraft d; d.id = "4b1a0e2d-7c7b-4b7e-9a3a-5c3e2e1f0a11"; d.catId = "cat"; d.fedAtMs = 1700000000000LL; d.amountMg = 51974; d.unit = domain::FoodUnit::Cans; d.enteredValue = "1/3";
    const auto line = application::encodeDraft(d);
    TEST_ASSERT_EQUAL(std::string::npos, line.find('\n'));
    domain::FeedingDraft back;
    TEST_ASSERT_TRUE(application::decodeDraft(line, back));
    TEST_ASSERT_EQUAL_STRING("1/3", back.enteredValue.c_str());
    TEST_ASSERT_EQUAL(domain::FoodUnit::Cans, back.unit);
    TEST_ASSERT_EQUAL_INT64(1700000000000LL, back.fedAtMs);
    const auto arr = application::encodeDraftsArray({d, d});
    TEST_ASSERT_EQUAL_CHAR('[', arr.front()); TEST_ASSERT_EQUAL_CHAR(']', arr.back());
    JsonDocument doc; TEST_ASSERT_FALSE(deserializeJson(doc, arr));
    TEST_ASSERT_EQUAL_UINT32(2, doc.as<JsonArray>().size());
    TEST_ASSERT_EQUAL_STRING("can", doc[0]["enteredUnit"]);
    TEST_ASSERT_FALSE(decodeDraftFails("{\"id\":1}"));
}

void test_accepted_ids_and_server_now() {
    int64_t now = 0;
    const auto ids = application::decodeAcceptedIds("{\"accepted\":[\"a\",\"b\"],\"clamped\":[\"b\"],\"now\":1700000000123}", &now);
    TEST_ASSERT_EQUAL_UINT32(2, ids.size());
    TEST_ASSERT_EQUAL_STRING("b", ids[1].c_str());
    TEST_ASSERT_EQUAL_INT64(1700000000123LL, now);
    TEST_ASSERT_EQUAL_UINT32(0, application::decodeAcceptedIds("nope", nullptr).size());
}

void test_log_entry_encoding_keeps_data_as_json() {
    const auto l = application::encodeLogEntry(1700000000000LL, "info", "idle cat=Mochi level=content", "{\"rssi\":-60}");
    JsonDocument d; TEST_ASSERT_FALSE(deserializeJson(d, l));
    TEST_ASSERT_EQUAL_STRING("info", d["level"]);
    TEST_ASSERT_EQUAL_INT(-60, d["data"]["rssi"].as<int>());
    const auto none = application::encodeLogEntry(1, "warn", "x", nullptr);
    TEST_ASSERT_FALSE(deserializeJson(d, none)); TEST_ASSERT_FALSE(d["data"].is<JsonObject>());
    TEST_ASSERT_EQUAL_STRING("[{\"a\":1},{\"b\":2}]", application::joinArray({"{\"a\":1}", "{\"b\":2}"}).c_str());
}
```

(`decodeDraftFails` is a 3-line static helper in the test file calling `decodeDraft` and returning its bool.)

- [ ] **Step 3: Run** → FAIL. Register the six tests.

- [ ] **Step 4: Write the ports** (one header each, all `#pragma once`, `namespace feedme2::ports`, pure virtual with virtual destructors) exactly as listed in Interfaces. `INetwork.h` also defines:

```cpp
struct NetResult {
    enum class Kind : uint8_t { Ok, NotModified, Transient, Unauthorized, Permanent };
    Kind kind = Kind::Transient;
    int status = 0;
    std::string body;
    std::string etag;
    bool ok() const { return kind == Kind::Ok; }
    static NetResult fromStatus(int status, std::string body, std::string etag = "") {
        NetResult r; r.status = status; r.body = std::move(body); r.etag = std::move(etag);
        if (status == 304) r.kind = Kind::NotModified;
        else if (status >= 200 && status < 300) r.kind = Kind::Ok;
        else if (status == 401) r.kind = Kind::Unauthorized;
        else if (status == 408 || status == 429 || status >= 500 || status <= 0) r.kind = Kind::Transient;
        else r.kind = Kind::Permanent;
        return r;
    }
};
```

- [ ] **Step 5: Write `StateCodec.{h,cpp}` and `QueueCodec.{h,cpp}`** with ArduinoJson 7 (`JsonDocument`; `deserializeJson(doc, json)`; `serializeJson(doc, out)`). `decodeState` requires `house.settings`, `cats` (array), `now`; parses colours from `#rrggbb` with `strtoul`; `defaultAmountMg`/`lastFedAt` null → `hasDefault=false`/`hasLastFed=false`; calls `out.sortCats()`; on any missing required field returns false with `err = "missing <field>"`. `encodeDraft` writes `fedAt` as an integer (ArduinoJson supports `int64_t`). `encodeLogEntry` embeds `data` by deserialising the given JSON string into a nested object (skip `data` when the string is null or fails to parse).

- [ ] **Step 6: Write `test_application/stubs.h`**

```cpp
#pragma once
#include <deque>
#include <map>
#include <string>
#include <vector>
#include "ports/IClock.h"
#include "ports/IFileQueue.h"
#include "ports/IInput.h"
#include "ports/ILogSink.h"
#include "ports/INetwork.h"
#include "ports/IPower.h"
#include "ports/IRandom.h"
#include "ports/IStorage.h"

namespace feedme2::test {
using namespace feedme2::ports;

struct StubClock : IClock { uint32_t ms = 0; uint32_t monotonicMs() override { return ms; } void advance(uint32_t d) { ms += d; } };
struct StubRandom : IRandom { int n = 0; std::string uuid() override { char b[40]; std::snprintf(b, sizeof b, "00000000-0000-4000-8000-%012d", ++n); return b; } uint32_t next() override { return static_cast<uint32_t>(++n); } };
struct StubInput : IInput { std::deque<application::InputEvent> q; bool held = false; application::InputEvent poll() override { if (q.empty()) return application::InputEvent::None; auto e = q.front(); q.pop_front(); return e; } bool isHeld() const override { return held; } };
struct StubStorage : IStorage {
    std::map<std::string, std::string> kv; int writes = 0;
    bool read(const char* k, std::string& out) override { auto it = kv.find(k); if (it == kv.end()) return false; out = it->second; return true; }
    bool write(const char* k, const std::string& v) override { kv[k] = v; ++writes; return true; }
    bool erase(const char* k) override { return kv.erase(k) > 0; }
};
struct StubFileQueue : IFileQueue {
    std::map<std::string, std::vector<std::string>> files; int appends = 0, rewrites = 0;
    bool appendLine(const char* f, const std::string& l) override { files[f].push_back(l); ++appends; return true; }
    bool readLines(const char* f, std::vector<std::string>& out) override { out = files[f]; return true; }
    bool rewrite(const char* f, const std::vector<std::string>& lines) override { files[f] = lines; ++rewrites; return true; }
};
struct StubPower : IPower {
    int backlight = 100; bool displayAsleep = false; int lightSleeps = 0; uint32_t lastRgb = 0;
    void setBacklight(uint8_t p) override { backlight = p; }
    void displaySleep(bool on) override { displayAsleep = on; }
    void lightSleep(uint32_t) override { ++lightSleeps; }
    void ledRing(uint32_t rgb, uint8_t) override { lastRgb = rgb; }
};
struct StubLogSink : ILogSink { std::vector<std::string> lines; void write(const char* lvl, const char* msg, const char* data) override { lines.push_back(std::string(lvl) + " " + msg + (data ? std::string(" ") + data : "")); } };
struct StubNetwork : INetwork {
    bool online = true; std::string token;
    std::deque<NetResult> stateResults, feedingResults, logResults, heartbeatResults, pairStartResults, pairCheckResults;
    std::vector<std::string> postedFeedings, postedLogs, postedHeartbeats, ifNoneMatch;
    static NetResult ok(std::string body, std::string etag = "") { return NetResult::fromStatus(200, std::move(body), std::move(etag)); }
    static NetResult status(int s, std::string body = "") { return NetResult::fromStatus(s, std::move(body)); }
    NetResult take(std::deque<NetResult>& q) { if (q.empty()) return status(0); auto r = q.front(); q.pop_front(); return r; }
    bool isOnline() const override { return online; }
    void setToken(const std::string& t) override { token = t; }
    NetResult pairStart(const std::string&, const std::string&, const std::string&) override { return take(pairStartResults); }
    NetResult pairCheck(const std::string&) override { return take(pairCheckResults); }
    NetResult getState(const std::string& inm) override { ifNoneMatch.push_back(inm); return take(stateResults); }
    NetResult postFeedings(const std::string& j) override { postedFeedings.push_back(j); return take(feedingResults); }
    NetResult postLogs(const std::string& j) override { postedLogs.push_back(j); return take(logResults); }
    NetResult postHeartbeat(const std::string& j) override { postedHeartbeats.push_back(j); return take(heartbeatResults); }
};
}  // namespace feedme2::test
```

- [ ] **Step 7: Run** `pio test -e native` → green (35 cases); `pio run -e crowpanel` still builds (ports/application compile in the Arduino env too). Commit:

```bash
git add firmware/src/ports firmware/src/application/StateCodec.h firmware/src/application/StateCodec.cpp firmware/src/application/QueueCodec.h firmware/src/application/QueueCodec.cpp firmware/test/test_application/stubs.h firmware/test/test_application/test_state_codec.cpp firmware/test/test_application/test_queue_codec.cpp firmware/test/test_application/runner.cpp firmware/src/application/Version.h
git commit -m "feat(firmware): ports, test doubles and json codecs for state, feedings and logs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: `LogService` and `FeedingService` (persisted queues)

**Files:**
- Create: `firmware/src/application/LogService.h`, `LogService.cpp`, `FeedingService.h`, `FeedingService.cpp`
- Create: `firmware/test/test_application/test_log_service.cpp`, `test_feeding_service.cpp`
- Modify: `firmware/test/test_application/runner.cpp`

**Interfaces:**
- `LogService(ports::ILogSink& serial, ports::IFileQueue& files, ports::IClock&, domain::ClockModel&)`: `void info(const char* msg, const char* dataJson = nullptr)`, `warn`, `error`; `void event(const char* name, const char* kv)` → writes `[feedme2] <name> <kv>` to the serial sink AND queues an info line `name kv`; `size_t pending() const`; `std::vector<std::string> takeBatch(size_t max = 50)` (returns the oldest lines and removes them from the file); `void requeue(std::vector<std::string>)`; persistence: every queued line is `appendLine("/logs.jsonl", …)`; cap 300 lines on disk (rewrite when exceeded); `void loadFromDisk()`.
- `FeedingService(ports::IFileQueue&, ports::IRandom&, domain::ClockModel&, LogService&)`: `void loadFromDisk()`, `std::vector<domain::FeedingDraft> commit(domain::FeedFlow& flow, int64_t nowMs)` (confirms the flow, pushes drafts, persists, logs `feeding queued id=… cat=… mg=…`, returns them), `const domain::FeedingQueue& queue() const`, `std::vector<domain::FeedingDraft> headBatch(size_t n = 20)`, `void markAccepted(const std::vector<std::string>& ids)` (removes + rewrites the file), `std::vector<domain::FeedingDraft> recent(size_t n = 5)` (last n queued or sent — kept in a 5-entry ring for the History overlay; sent ones come from the state's cats as well, see Task 10).

- [ ] **Step 1: Failing `test_log_service.cpp`**

```cpp
#include <unity.h>
#include "application/LogService.h"
#include "stubs.h"
using namespace feedme2;

void test_log_service_event_prints_machine_line_and_queues_upload() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; domain::ClockModel model;
    application::LogService log(serial, files, clk, model);
    log.event("idle", "cat=Mochi level=content");
    TEST_ASSERT_EQUAL_UINT32(1, serial.lines.size());
    TEST_ASSERT_EQUAL_STRING("info [feedme2] idle cat=Mochi level=content", serial.lines[0].c_str());
    TEST_ASSERT_EQUAL_UINT32(1, log.pending());
    TEST_ASSERT_EQUAL_INT(1, files.appends);
    auto batch = log.takeBatch(50);
    TEST_ASSERT_EQUAL_UINT32(1, batch.size());
    TEST_ASSERT_EQUAL_UINT32(0, log.pending());
    TEST_ASSERT_EQUAL_INT(1, files.rewrites);
    log.requeue(batch);
    TEST_ASSERT_EQUAL_UINT32(1, log.pending());
}

void test_log_service_caps_disk_lines_and_reloads() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; domain::ClockModel model;
    {
        application::LogService log(serial, files, clk, model);
        for (int i = 0; i < 350; ++i) log.info("spam");
        TEST_ASSERT_EQUAL_UINT32(300, log.pending());
    }
    application::LogService again(serial, files, clk, model);
    again.loadFromDisk();
    TEST_ASSERT_EQUAL_UINT32(300, again.pending());
}
```

- [ ] **Step 2: Failing `test_feeding_service.cpp`**

```cpp
#include <unity.h>
#include "application/FeedingService.h"
#include "application/LogService.h"
#include "stubs.h"
using namespace feedme2;

static domain::DeviceState oneCat() { domain::DeviceState s; domain::CatState c; c.id = "cat-a"; c.name = "Mochi"; c.hasDefault = true; c.defaultAmountMg = 40000; c.defaultUnit = domain::FoodUnit::Grams; c.defaultValue = "40"; s.cats = {c}; return s; }

void test_feeding_service_commit_persists_and_survives_reload() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; test::StubRandom rnd; domain::ClockModel model;
    application::LogService log(serial, files, clk, model);
    auto s = oneCat();
    {
        application::FeedingService svc(files, rnd, model, log);
        domain::FeedFlow flow; flow.begin(s, &s.cats[0], 0);
        auto drafts = svc.commit(flow, 1700000000000LL);
        TEST_ASSERT_EQUAL_UINT32(1, drafts.size());
        TEST_ASSERT_EQUAL_UINT32(1, svc.queue().size());
        TEST_ASSERT_EQUAL_UINT32(1, files.files["/feedings.jsonl"].size());
        TEST_ASSERT_TRUE(serial.lines.back().find("[feedme2] feeding queued id=") != std::string::npos);
    }
    application::FeedingService again(files, rnd, model, log);
    again.loadFromDisk();
    TEST_ASSERT_EQUAL_UINT32(1, again.queue().size());
    again.markAccepted({again.queue().items()[0].id});
    TEST_ASSERT_TRUE(again.queue().empty());
    TEST_ASSERT_EQUAL_UINT32(0, files.files["/feedings.jsonl"].size());
}

void test_feeding_service_keeps_last_five_for_history() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; test::StubRandom rnd; domain::ClockModel model;
    application::LogService log(serial, files, clk, model);
    application::FeedingService svc(files, rnd, model, log);
    auto s = oneCat();
    for (int i = 0; i < 7; ++i) { domain::FeedFlow f; f.begin(s, &s.cats[0], 0); svc.commit(f, 1000 + i); }
    auto r = svc.recent(5);
    TEST_ASSERT_EQUAL_UINT32(5, r.size());
    TEST_ASSERT_EQUAL_INT64(1006, r[0].fedAtMs);  // newest first
}
```

- [ ] **Step 3: Run** → FAIL. Register the four tests.

- [ ] **Step 4: Implement** `LogService` (ring of pending JSON lines mirrored to `/logs.jsonl`; `event()` formats `[feedme2] name kv` and writes it to the sink at info; `takeBatch` rewrites the file with the remainder; `loadFromDisk` reads the file and keeps the last 300) and `FeedingService` (wraps `FeedingQueue`; `commit` calls `flow.confirm([&]{ return rnd.uuid(); }, nowMs)`, pushes each draft, `appendLine("/feedings.jsonl", encodeDraft(d))`, logs the event, pushes into a 5-entry `recent_` deque newest-first; `markAccepted` removes and `rewrite`s the file; `loadFromDisk` decodes each line, skipping malformed ones with a warn).

- [ ] **Step 5: Run** `pio test -e native` → green (39 cases). Commit:

```bash
git add firmware/src/application/LogService.h firmware/src/application/LogService.cpp firmware/src/application/FeedingService.h firmware/src/application/FeedingService.cpp firmware/test/test_application/test_log_service.cpp firmware/test/test_application/test_feeding_service.cpp firmware/test/test_application/runner.cpp firmware/src/application/Version.h
git commit -m "feat(firmware): persisted log and feeding queues with machine-readable event lines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: `PairCoordinator`

**Files:**
- Create: `firmware/src/application/PairCoordinator.h`, `PairCoordinator.cpp`, `firmware/test/test_application/test_pair.cpp`
- Modify: `firmware/test/test_application/runner.cpp`

**Interfaces:**
- `enum class PairPhase { Idle, Starting, Pending, Confirmed, Expired, Failed }`; `struct PairView { PairPhase phase; std::string pairCode; int64_t expiresAt; std::string error; }`; `PairCoordinator(ports::INetwork&, ports::IStorage&, ports::IClock&, LogService&, std::string deviceId, std::string hwModel, std::string fwVersion)`: `bool isPaired() const` (token in storage), `void start()`, `void tick(uint32_t nowMs)` (polls every `pollAfterSec` from the start response, default 3 s; `Expired` → restart automatically after 2 s; `Failed` → retry start after 5 s), `const PairView& view() const`, `void clearToken()` (storage erase + `network.setToken("")`), `std::string token() const`; on `Confirmed` writes `token` and `name` to storage and calls `network.setToken`.

- [ ] **Step 1: Failing `test_pair.cpp`**

```cpp
#include <unity.h>
#include "application/PairCoordinator.h"
#include "application/LogService.h"
#include "stubs.h"
using namespace feedme2;

struct Rig {
    test::StubNetwork net; test::StubStorage store; test::StubClock clk; test::StubLogSink serial; test::StubFileQueue files; domain::ClockModel model;
    application::LogService log{serial, files, clk, model};
    application::PairCoordinator pc{net, store, clk, log, "0123456789abcdef0123456789abcdef", "device-sim", "0.2.0"};
};

void test_pair_start_pending_confirmed_persists_token() {
    Rig r;
    TEST_ASSERT_FALSE(r.pc.isPaired());
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"123456\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.pc.start();
    TEST_ASSERT_EQUAL(application::PairPhase::Pending, r.pc.view().phase);
    TEST_ASSERT_EQUAL_STRING("123456", r.pc.view().pairCode.c_str());
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"pending\"}"));
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"confirmed\",\"deviceToken\":\"tok\",\"houseId\":\"h\",\"houseName\":\"H\",\"deviceName\":\"Kitchen\"}"));
    r.pc.tick(1000);                       // too early: no poll yet
    TEST_ASSERT_EQUAL_UINT32(2, r.net.pairCheckResults.size());
    r.pc.tick(3100);                       // first poll → pending
    TEST_ASSERT_EQUAL(application::PairPhase::Pending, r.pc.view().phase);
    r.pc.tick(6200);                       // second poll → confirmed
    TEST_ASSERT_EQUAL(application::PairPhase::Confirmed, r.pc.view().phase);
    TEST_ASSERT_TRUE(r.pc.isPaired());
    TEST_ASSERT_EQUAL_STRING("tok", r.store.kv["token"].c_str());
    TEST_ASSERT_EQUAL_STRING("Kitchen", r.store.kv["name"].c_str());
    TEST_ASSERT_EQUAL_STRING("tok", r.net.token.c_str());
    TEST_ASSERT_TRUE(r.serial.lines.back().find("[feedme2] paired house=h") != std::string::npos);
}

void test_pair_expired_restarts_and_transient_failure_retries() {
    Rig r;
    r.net.pairStartResults.push_back(test::StubNetwork::status(503));
    r.pc.start();
    TEST_ASSERT_EQUAL(application::PairPhase::Failed, r.pc.view().phase);
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"654321\",\"expiresAt\":1,\"pollAfterSec\":1}"));
    r.pc.tick(5100);                       // retry after 5 s
    TEST_ASSERT_EQUAL(application::PairPhase::Pending, r.pc.view().phase);
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"expired\"}"));
    r.pc.tick(6200);
    TEST_ASSERT_EQUAL(application::PairPhase::Expired, r.pc.view().phase);
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"111111\",\"expiresAt\":1,\"pollAfterSec\":3}"));
    r.pc.tick(8300);                       // auto restart after 2 s
    TEST_ASSERT_EQUAL_STRING("111111", r.pc.view().pairCode.c_str());
}

void test_pair_clear_token() {
    Rig r;
    r.store.kv["token"] = "tok";
    TEST_ASSERT_TRUE(r.pc.isPaired());
    r.pc.clearToken();
    TEST_ASSERT_FALSE(r.pc.isPaired());
    TEST_ASSERT_EQUAL_STRING("", r.net.token.c_str());
}
```

- [ ] **Step 2: Run** → FAIL. Register. **Step 3: Implement** per the interface (ArduinoJson to read `pairCode`, `pollAfterSec`, `status`, `deviceToken`, `houseId`, `deviceName`; `Unauthorized`/`Permanent` on start → `Failed` with `error = body.slice(0,60)`; log events `pair start code=…`, `paired house=…`). **Step 4:** `pio test -e native` → 42 green. Commit `feat(firmware): pairing coordinator with code polling, expiry restart and token persistence`.

---

## Task 8: `SyncService`

**Files:**
- Create: `firmware/src/application/SyncService.h`, `SyncService.cpp`, `firmware/test/test_application/test_sync.cpp`
- Modify: `firmware/test/test_application/runner.cpp`

**Interfaces:**
- `SyncService(ports::INetwork&, ports::IStorage&, ports::IClock&, domain::ClockModel&, FeedingService&, LogService&, PairCoordinator&)`: `void loadCachedState()` (storage `state` + `etag` → `state_`, so Idle renders before Wi-Fi), `bool hasState() const`, `const domain::DeviceState& state() const`, `void requestRound(const char* reason)` (flags a round; reasons: `wake`, `feeding`, `paired`, `timer`, `boot`), `void tick(uint32_t nowMs)` (runs at most one round per tick when requested and online; also requests a `timer` round every `state.settings.syncIntervalSec`), `struct RoundResult { bool ran; int feedingsSent, feedingsAccepted; int logsSent; bool stateChanged; bool heartbeatOk; bool unauthorized; std::string stoppedBy; }`, `const RoundResult& last() const`, `uint32_t generation() const` (increments when `state_` changes), `bool lastRoundOk() const`, `uint32_t lastOkAtMs() const`.
- Round order (spec §5.3): feedings (batches of 20 via `postFeedings`; on Ok → `markAccepted(ids)` and `clock.syncFromServer(now)`; Transient → stop round; Permanent (400/404/409) → drop the batch with an `error` log; Unauthorized → `pair.clearToken()`, set `unauthorized`, stop) → logs (`takeBatch(50)` → `postLogs`; Transient → `requeue` + stop; Permanent → drop) → `getState(etag)` (Ok → decode; on decode failure log error and keep old state; store `state` JSON + `etag`; `clock.syncFromServer(state.now)`; NotModified → keep; Unauthorized → clearToken; Transient → stop) → heartbeat (`encodeHeartbeat`; failure is logged, not fatal). Every outcome logs `[feedme2] sync ok accepted=N state=changed|same` or `[feedme2] sync stopped at=<step> status=<n>`.

- [ ] **Step 1: Failing `test_sync.cpp`** — a `Rig` like Task 7 plus `FeedingService` and `SyncService`; tests:
  1. `round_order_and_success`: queue one feeding and one log line; push `feedingResults: ok({"accepted":["<id>"],"clamped":[],"now":1700000000000})`, `logResults: status(202)`, `stateResults: ok(sampleFixtureJson, 'W/"abc"')`, `heartbeatResults: ok({"now":…})`; `requestRound("feeding")`, `tick` → `last()` has `feedingsAccepted 1, logsSent 1, stateChanged true, heartbeatOk true`; queue empty; `store.kv["etag"] == 'W/"abc"'`; `model.isSynced()`; `net.ifNoneMatch[0] == ""`; the next round with `stateResults: status(304)` sends `If-None-Match W/"abc"` and reports `stateChanged false`; serial contains `[feedme2] sync ok accepted=1 state=changed`.
  2. `transient_failure_keeps_feedings_and_stops`: `feedingResults: status(503)` → `last().stoppedBy == "feedings"`, queue still 1, no state call made (`net.ifNoneMatch.empty()`).
  3. `permanent_failure_drops_batch_and_continues`: `feedingResults: status(404, '{"error":"cat_not_found","catIds":["x"]}')` → queue empty, an `error` log line queued, state fetched.
  4. `unauthorized_clears_token_and_routes_to_pair`: `stateResults: status(401)` → `last().unauthorized`, `pair.isPaired() == false`.
  5. `cached_state_loads_before_network`: `store.kv["state"] = sample; store.kv["etag"] = 'W/"x"'` → `loadCachedState()` → `hasState()` with 2 cats and `generation() == 1`.
  6. `timer_round_every_sync_interval`: state with `syncIntervalSec = 60`; after `tick(61'000)` a round ran with reason `timer` (assert via the serial line `sync start reason=timer`).
  7. `offline_skips_round_until_online`: `net.online = false; requestRound("wake"); tick` → `last().ran == false`; `net.online = true; tick` → ran.

- [ ] **Step 2: Run** → FAIL. Register. **Step 3: Implement.** **Step 4:** `pio test -e native` → 49 green. Commit `feat(firmware): sync service — feedings, logs, etag state and heartbeat in one round`.

---

## Task 9: `PowerManager`

**Files:**
- Create: `firmware/src/application/PowerManager.h`, `PowerManager.cpp`, `firmware/test/test_application/test_power.cpp`
- Modify: `firmware/test/test_application/runner.cpp`

**Interfaces:**
- `enum class PowerTier { Awake, Dim, LightSleep }`; `PowerManager(ports::IPower&, ports::IClock&, LogService&)`: `void noteInput(uint32_t nowMs)` (returns to Awake; backlight 100), `void tick(uint32_t nowMs)` (Awake → Dim after `kDimAfterMs = 15'000` (backlight 30%), Dim → LightSleep after `kSleepAfterMs = 30'000` from the last input (display sleep-in, backlight 0, LED off, `power.lightSleep(…)` with a max of `sleepTimeoutSec` ms, then on return `tick` treats the next poll as a wake)), `PowerTier tier() const`, `bool consumeWakeEvent()` (true exactly once after leaving Dim/LightSleep — the UI swallows that first event, Review Focus 1), `void setSleepTimeoutSec(int32_t)`, `void setSyncIntervalSec(int32_t)`, `bool timerWakeDue(uint32_t nowMs)` (true once per `syncIntervalSec` while sleeping, for the timer sync round; deep sleep arrives in Phase 3 behind the same port).

- [ ] **Step 1: Failing `test_power.cpp`**: (1) `awake_dims_then_sleeps_and_input_wakes`: tick 0 → Awake, backlight 100; tick 15'001 → Dim, backlight 30; tick 30'001 → LightSleep, `displayAsleep`, backlight 0, `lightSleeps == 1`; `noteInput(31'000)` → Awake, backlight 100, `displayAsleep == false`, `consumeWakeEvent()` true then false. (2) `input_while_dim_is_swallowed_once`: tick 16'000 → Dim; `noteInput` → `consumeWakeEvent()` true; a second `noteInput` → false. (3) `timer_wake_due_once_per_interval`: `setSyncIntervalSec(60)`; sleeping; `timerWakeDue(90'000)` false, `(31'000 + 60'000)` true once, then false until the next interval. (4) `sleep_timeout_from_settings_bounds_light_sleep_call` (arg to `lightSleep` ≤ `sleepTimeoutSec*1000`, captured in the stub).

- [ ] **Step 2–4:** implement, 53 green, commit `feat(firmware): power tiers — dim, light sleep, swallowed wake event, timer wake`.

---

## Task 10: `App` — wiring and the input grammar

**Files:**
- Create: `firmware/src/application/App.h`, `App.cpp`, `firmware/test/test_application/test_app.cpp`
- Modify: `firmware/test/test_application/runner.cpp`

**Interfaces:**
- `struct AppDeps { ports::IClock& clock; ports::IRandom& random; ports::IInput& input; ports::INetwork& network; ports::IStorage& storage; ports::IFileQueue& files; ports::IPower& power; ports::ILogSink& serial; std::string deviceId; std::string hwModel; const char* fwVersion; }`; `class App { explicit App(AppDeps); void begin(); void tick(uint32_t nowMs); domain::Router& router(); const domain::CatRoster& roster() const; const domain::FeedFlow& flow() const; SyncService& sync(); PairCoordinator& pair(); PowerManager& power(); LogService& log(); FeedingService& feedings(); uint32_t uiGeneration() const /* bumps on anything the screens must redraw */; domain::HungerState hungerOf(const domain::CatState&) const; bool clockSynced() const; }`.
- `begin()`: loads cached state, logs, queue; `router.replaceRoot(pair.isPaired() ? Idle : Pair)`; if not paired → `pair.start()`; else `sync.requestRound("boot")`. Prints `[feedme2] boot ok fw=… paired=0|1 cats=N`.
- `tick()`: `power.tick`; polls input; if `power.consumeWakeEvent()` swallow it (and `sync.requestRound("wake")`); otherwise dispatch per the table in spec §5.2 (Idle: rotate → `roster.rotate`, Press → `flow.begin(state, roster.selected(), now)` + `router.push(Amount)`, LongPress → `push(System)`, DoubleTap → `push(History)`; Amount: rotate → `flow.rotate`, Press → `feedings.commit(flow, clock.nowMs())` + `router.replaceRoot(Idle)` + `push(Fed)` + `sync.requestRound("feeding")`, LongPress → `flow.cancel()` + pop; Fed: Press or 2 s → pop; History: rotate scrolls (`historyOffset_`), Press → pop; System: rotate → `menuIndex_` wrap over {Wi-Fi, Pair/Unpair, About, Sleep now}, Press → open, LongPress → pop; UnpairConfirm: LongPress → `pair.clearToken()` + `replaceRoot(Pair)` + `pair.start()`; Pair: Press → `pair.start()`; About/WifiList: LongPress → pop); then `pair.tick` (when on Pair; on Confirmed → `replaceRoot(Idle)`, `sync.requestRound("paired")`), `sync.tick`, if `sync.last().unauthorized` → `replaceRoot(Pair)` + `pair.start()`; when `sync.generation()` changed → `roster.setState(state)`, `power.setSleepTimeoutSec/SyncIntervalSec`; `uiGeneration_` bumps on router change, roster change, flow change, sync generation change, power tier change. Every router change prints `[feedme2] screen=<name>`; Idle also prints `[feedme2] idle cat=<name|all> level=<level>`.

- [ ] **Step 1: Failing `test_app.cpp`** (a `Rig` holding all stubs + `App`): (1) `boot_unpaired_shows_pair_and_starts_pairing`; (2) `boot_paired_with_cached_state_renders_idle_and_requests_sync` (serial has `screen=idle` and `idle cat=Mochi level=…`); (3) `knob_feed_flow_single_cat` (push Press, RotateCW, Press → queue has 1 draft of 45 000 mg, router at Fed, `[feedme2] feeding queued` printed, a `feeding` round requested → with `feedingResults: ok(...)` the next tick sends it); (4) `all_cats_feed_creates_one_per_cat`; (5) `double_tap_history_and_long_press_system_menu`; (6) `unauthorized_during_sync_returns_to_pair`; (7) `first_event_after_dim_is_swallowed` (power: tick to Dim, push RotateCW → roster index unchanged); (8) `unpair_long_press_clears_token`.

- [ ] **Step 2–4:** implement; `pio test -e native` → ≥ 61 cases green; commit `feat(firmware): app wiring — screens routing, knob grammar, sync and power glue`.

---
## Task 11: ESP32 adapters — clock, random, storage, queues, input, power, serial sink

**Files:**
- Create: `firmware/src/adapters/ArduinoClock.h`, `EspRandom.h`, `NvsStorage.h`, `LittleFsQueue.h`, `LittleFsQueue.cpp`, `RotaryInput.h`, `Cst816Touch.h`, `Cst816Touch.cpp`, `CompositeInput.h`, `EspPower.h`, `EspPower.cpp`, `LedRing.h`, `LedRing.cpp`, `SerialLogSink.h`
- Verified by: `pio run -e crowpanel` (compiles) — adapters are not host-tested; their logic is thin and the domain/application behind them is.

**Interfaces:**
- Each adapter implements exactly one port from Task 5 with the pins from Global Constraints. `RotaryInput` (polled, howler's quadrature table, 4 edges per detent, `kLongPressMs 600`, `kDoubleTapMs 350`, long-press fired eagerly while held, release after long is silent, short release deferred `kDoubleTapMs` → Press / second release in window → DoubleTap); `Cst816Touch` (I²C 0x15, polled 50 Hz, finger count reg 0x02, XY 0x03; tap < 300 ms and < 10 px → Press; horizontal swipe ≥ 36 px → SwipeLeft/SwipeRight; long touch ≥ 600 ms → LongPress; `isHeld`); `CompositeInput<A,B>` round-robins `poll()` and ORs `isHeld()`; `EspPower` (`setBacklight` via `ledcWrite` on BL 46 channel 0, 5 kHz 8-bit; `displaySleep(true)` sends GC9A01 `0x10` sleep-in via `tft.writecommand`, `false` sends `0x11` + 120 ms; `lightSleep(maxMs)`: `esp_sleep_enable_gpio_wakeup()` with GPIO 41/45/5 as low-level wake, `esp_sleep_enable_timer_wakeup(maxMs*1000)`, `esp_light_sleep_start()`; `ledRing` via NeoPixel on 48 with the LED rail GPIO 2 driven HIGH on first use); `SerialLogSink` prints `[level] msg data`; `NvsStorage` (`Preferences` namespace `feedme2`); `LittleFsQueue` (`LittleFS.begin(true)`; `appendLine` with `FILE_APPEND`; `readLines` splits on `\n`; `rewrite` writes a temp file then renames); `ArduinoClock::monotonicMs = millis()`; `EspRandom::uuid` from `esp_random()` formatted as v4.

- [ ] **Step 1: Write the adapters** following the interfaces; keep each under 150 lines; comments name the CrowPanel quirks (GPIO 1/2 rails, DC=3, LVGL 9 buffer type, light-sleep wake pins outside the RTC domain are fine for *light* sleep).

`RotaryInput.h` core (from howler, verified on this board):
```cpp
static constexpr int8_t kDelta[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
// in poll():
const uint8_t curr = (digitalRead(kPinA) << 1) | digitalRead(kPinB);
accumulator_ += kDelta[(prev_ << 2) | curr];
prev_ = curr;
if (accumulator_ >= 4) { accumulator_ = 0; return InputEvent::RotateCW; }
if (accumulator_ <= -4) { accumulator_ = 0; return InputEvent::RotateCCW; }
```

`EspPower::lightSleep`:
```cpp
void EspPower::lightSleep(uint32_t maxMs) {
    gpio_wakeup_enable(GPIO_NUM_41, GPIO_INTR_LOW_LEVEL);
    gpio_wakeup_enable(GPIO_NUM_45, GPIO_INTR_LOW_LEVEL);
    gpio_wakeup_enable(GPIO_NUM_5, GPIO_INTR_LOW_LEVEL);
    esp_sleep_enable_gpio_wakeup();
    esp_sleep_enable_timer_wakeup(static_cast<uint64_t>(maxMs) * 1000ULL);
    // Wi-Fi stays associated in modem sleep; RAM is retained; resume < 100 ms (spec §5.5).
    esp_light_sleep_start();
}
```

- [ ] **Step 2: Build** `cd firmware && pio run -e crowpanel` → success (nothing references the adapters yet besides compiling them; add a `static_assert` or a dummy include in `main.cpp` only if PlatformIO's LDF skips them — it compiles everything under `src/`).

- [ ] **Step 3: Commit**

```bash
git add firmware/src/adapters/ArduinoClock.h firmware/src/adapters/EspRandom.h firmware/src/adapters/NvsStorage.h firmware/src/adapters/LittleFsQueue.h firmware/src/adapters/LittleFsQueue.cpp firmware/src/adapters/RotaryInput.h firmware/src/adapters/Cst816Touch.h firmware/src/adapters/Cst816Touch.cpp firmware/src/adapters/CompositeInput.h firmware/src/adapters/EspPower.h firmware/src/adapters/EspPower.cpp firmware/src/adapters/LedRing.h firmware/src/adapters/LedRing.cpp firmware/src/adapters/SerialLogSink.h firmware/src/application/Version.h
git commit -m "feat(firmware): esp32 adapters for clock, nvs, littlefs queues, knob, touch, power and led ring

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 12: Wi-Fi — station, captive portal, HTTPS network adapter; simulator doubles

**Files:**
- Create: `firmware/src/adapters/WifiStation.h`, `WifiStation.cpp`, `WifiCaptivePortal.h`, `WifiCaptivePortal.cpp`, `WifiNetwork.h`, `WifiNetwork.cpp`, `FakeNetwork.h`, `FakeNetwork.cpp`, `SimulatedClock.h`
- Create: `firmware/src/adapters/FakeState.h` (generated: the sample fixture as a C string — add a 10-line step to `assets/cats/render.py`? No: a tiny script `firmware/scripts/embed_fixture.py` run as a `pre:` extra script for the simulator env that writes `src/adapters/FakeState.h` from `../fixtures/device-state.sample.json`)
- Modify: `firmware/platformio.ini` (`[env:simulator]` adds `extra_scripts = pre:scripts/embed_fixture.py`)

**Interfaces:**
- `WifiStation`: `bool loadCredentials(ports::IStorage&, std::string& ssid, std::string& pass)` (NVS key `wifi`, format `[u16 len][ssid][u16 len][pass]`), `bool connect(const std::string& ssid, const std::string& pass, uint32_t budgetMs = 15000)`, `bool isConnected() const`, `int8_t rssi() const`, `std::vector<std::pair<std::string,int8_t>> scan()`; after association calls `configTime(0, 0, "pool.ntp.org", "time.google.com")`.
- `WifiCaptivePortal`: `[[noreturn]] void runAndReboot(ports::IStorage&)` — howler's flow: AP `feedme2-%02x%02x`, scan-before-AP, `DNSServer` on 53 → all hosts, `WebServer` on 80 with `GET /` form (`<select>` of SSIDs + free-text SSID + password) and `POST /save` writing the NVS blob, brownout muted (`WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0)`), `ESP.restart()` after save.
- `WifiNetwork : ports::INetwork` (`HTTPClient` + `WiFiClientSecure::setInsecure()` — the worker is behind Cloudflare's certificate; pinning is a Phase 3 item; 8 s timeout; `Authorization: Bearer <token>`; `If-None-Match` on `getState`; `collectHeaders({"ETag"})`; maps status → `NetResult::fromStatus`; transport failure → status 0), base URL from `-DFEEDME2_BACKEND_URL`.
- `FakeNetwork : ports::INetwork` (`-DSIMULATOR=1`): in-memory: `pairStart` → `{"pairCode":"424242","expiresAt":…,"pollAfterSec":1}`; `pairCheck` → pending twice then confirmed with token `sim-token`; `getState` → the embedded sample with `now` = clock + a fixed ETag, 304 when matched, and after any `postFeedings` it updates the matching cat's `lastFedAt`/defaults and changes the ETag; `postFeedings` → accepts all ids; `postLogs` 202; `postHeartbeat` ok. Deterministic, so Wokwi scenarios can assert `[feedme2] sync ok accepted=1 state=changed`.
- `SimulatedClock : ports::IClock` — `millis()` × `kSimSpeed` (default 1; set `-DFEEDME2_SIM_SPEED=60` to run hunger arcs fast in a scenario).

- [ ] **Step 1: `firmware/scripts/embed_fixture.py`**

```python
# Embeds fixtures/device-state.sample.json as a C string for the simulator's FakeNetwork.
Import("env")
from pathlib import Path
import json
root = Path(env["PROJECT_DIR"]).parent
src = root / "fixtures" / "device-state.sample.json"
out = Path(env["PROJECT_DIR"]) / "src" / "adapters" / "FakeState.h"
data = json.dumps(json.loads(src.read_text(encoding="utf-8")), separators=(",", ":"))
body = data.replace("\\", "\\\\").replace('"', '\\"')
out.write_text("// generated by scripts/embed_fixture.py — do not edit\n#pragma once\nnamespace feedme2::adapters { inline const char* kFakeStateJson = \"" + body + "\"; }\n", encoding="utf-8")
```

Add `firmware/src/adapters/FakeState.h` to `firmware/.gitignore`.

- [ ] **Step 2: Write the adapters** per the interfaces (port howler's `WifiCaptivePortal.cpp` form and flow; `WifiNetwork` request helper:

```cpp
ports::NetResult WifiNetwork::request(const char* method, const std::string& path, const std::string& body, const std::string& ifNoneMatch) {
    if (WiFi.status() != WL_CONNECTED) return ports::NetResult::fromStatus(0, "offline");
    WiFiClientSecure client; client.setInsecure();
    HTTPClient http; http.setTimeout(8000);
    http.begin(client, baseUrl_ + path);
    http.addHeader("content-type", "application/json");
    if (!token_.empty()) http.addHeader("authorization", "Bearer " + String(token_.c_str()));
    if (!ifNoneMatch.empty()) http.addHeader("if-none-match", ifNoneMatch.c_str());
    const char* keys[] = {"ETag"}; http.collectHeaders(keys, 1);
    const int status = http.sendRequest(method, reinterpret_cast<const uint8_t*>(body.data()), body.size());
    std::string resp = status > 0 ? std::string(http.getString().c_str()) : std::string();
    std::string etag = http.header("ETag").c_str();
    http.end();
    return ports::NetResult::fromStatus(status, std::move(resp), std::move(etag));
}
```
)

- [ ] **Step 3: Build** `pio run -e crowpanel && pio run -e simulator` → both succeed; `FakeState.h` generated for the simulator env.

- [ ] **Step 4: Commit**

```bash
git add firmware/src/adapters/WifiStation.h firmware/src/adapters/WifiStation.cpp firmware/src/adapters/WifiCaptivePortal.h firmware/src/adapters/WifiCaptivePortal.cpp firmware/src/adapters/WifiNetwork.h firmware/src/adapters/WifiNetwork.cpp firmware/src/adapters/FakeNetwork.h firmware/src/adapters/FakeNetwork.cpp firmware/src/adapters/SimulatedClock.h firmware/scripts/embed_fixture.py firmware/platformio.ini firmware/.gitignore firmware/src/application/Version.h
git commit -m "feat(firmware): wi-fi station, captive portal, https device api client; simulator fakes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 13: Cat image assets as C arrays

**Files:**
- Modify: `assets/cats/render.py` (add the firmware outputs), `assets/cats/README.md`
- Create: `firmware/scripts/png_to_c.py` (called by render.py), `firmware/src/assets/cats/CatAssets.h`, generated `firmware/src/assets/cats/cat_<slug>_130.c` and `cat_<slug>_88.c` (12 × 2 files, committed)

**Interfaces:**
- `CatAssets.h`: `const lv_image_dsc_t* catImage(const char* slug /* "A1".."C4" */, uint8_t size /* 130 | 88 */)` returning a descriptor with `header.cf = LV_COLOR_FORMAT_RAW` (PNG bytes decoded by LVGL's lodepng at draw time), `header.w/h` = size; falls back to `C2` for an unknown slug. Images are **white on transparent** so `lv_obj_set_style_image_recolor(img, cat colour)` + `recolor_opa = LV_OPA_COVER` tints them (feedme's approach; LVGL 9 names).

- [ ] **Step 1: Extend `assets/cats/render.py`**: after the web masks, render each master to `size ∈ {130, 88}` white-on-transparent (`L` alpha → RGBA with RGB=255), `optimize=True`, and call `firmware/scripts/png_to_c.py <png> <symbol> <out.c>` which writes:

```c
// generated by assets/cats/render.py — do not edit
#include <lvgl.h>
static const uint8_t cat_c2_130_map[] = { 0x89, 0x50, ... };
const lv_image_dsc_t cat_c2_130 = {
    .header = { .magic = LV_IMAGE_HEADER_MAGIC, .cf = LV_COLOR_FORMAT_RAW, .flags = 0, .w = 130, .h = 130, .stride = 0 },
    .data_size = sizeof(cat_c2_130_map), .data = cat_c2_130_map,
};
```

(`LV_IMAGE_HEADER_MAGIC` exists in LVGL 9.0; verify the field names against `lvgl/src/draw/lv_image_dsc.h` of the pinned 9.0.0 and adjust.) `CatAssets.h` declares the 24 `extern const lv_image_dsc_t` and the lookup.

- [ ] **Step 2: Run** `python assets/cats/render.py` → 24 `.c` files; total size (`du -ch firmware/src/assets/cats/*.c`) under 250 KB of source, ≈ 70 KB of PNG bytes (spec D2). Re-run → byte-identical.

- [ ] **Step 3: Build** `pio run -e crowpanel` with `LV_USE_LODEPNG 1` → success; firmware size printed; note it in the commit body.

- [ ] **Step 4: Commit**

```bash
git add assets/cats/render.py assets/cats/README.md firmware/scripts/png_to_c.py firmware/src/assets/cats/CatAssets.h firmware/src/assets/cats/cat_A1_130.c firmware/src/assets/cats/cat_A1_88.c <… all 24 …> firmware/src/application/Version.h
git commit -m "feat(firmware): cat silhouettes embedded as png c arrays (130 px idle, 88 px fed)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 14: Screens and `main.cpp`

**Files:**
- Create: `firmware/src/screens/ScreenManager.h`, `ScreenManager.cpp`, `Theme.h`, `components/CatImage.h`, `components/HungerRing.h`, `components/LongPressArcWidget.h`, `components/RoundList.h`, `screen_boot.cpp`, `screen_pair.cpp`, `screen_idle.cpp`, `screen_amount.cpp`, `screen_fed.cpp`, `screen_history.cpp`, `screen_system.cpp`, `screen_wifi.cpp`, `screen_about.cpp`
- Rewrite: `firmware/src/main.cpp`

**Interfaces:**
- `ScreenManager(application::App&, TFT_eSPI&)`: `void begin()` (LVGL init exactly as Phase 0's `main.cpp`: 16-bpp byte buffer, flush via `pushColors`, `lv_tick_set_cb`), `void tick(uint32_t nowMs)` (rebuild when `app.router().current()` or `app.uiGeneration()` changed; `lv_timer_handler()`; update the arc widget from `app.power()`/input held state; Idle refreshes its "fed X ago" label every 30 s). One `void buildX()` per screen in its own `screen_*.cpp`, howler style (no screen base class).
- `Theme.h`: background `0x1a1226`, text `0xf6f1e6`, dim `0x9c97a4`, ring colours good `0x4CAF50` / warn `0xFFB300` / danger `0xE53935`, fonts montserrat 12/14/18/24/48.
- `CatImage::create(parent, slug, size, colorRgb)` → `lv_image` with recolor; `HungerRing::create(parent, diameter)` + `update(ratio, level, starvingPulse)` (an `lv_arc` 236 px, width 8, fill = 1 − min(ratio,1), colour by `levelColor`, `lv_anim` opacity pulse when starving); `LongPressArcWidget` from howler (236 px, rotation 270, track hidden until charging); `RoundList` — a 4-row vertical list (montserrat 18, selected row highlighted, wraps) used by System and Wi-Fi; `lv_qrcode` on the Pair screen.

- [ ] **Step 1: Screens, following spec §5.2 exactly**
  - **Boot**: wordmark + `kFirmwareVersion`.
  - **Pair**: `lv_qrcode_create(scr, 120, black, white)` with `https://feedme2-webapp.pages.dev/settings?pair=<code>`; the code as `"%c%c%c %c%c%c"` in montserrat_24; status line per `PairPhase` ("Enter this code in the app", "Expired — press to retry", "Paired!"); Press → `app.pair().start()` (App handles).
  - **Idle**: cat name (montserrat_18, top y=28); `HungerRing` centred; `CatImage` 130 px of `poseForLevel(level, avatarPose)` (same table as the webapp: fed → C4, content → avatar, peckish → A2, hungry → B2, very_hungry → B4, starving → C3) tinted with the cat colour, centred; "fed 2 h ago" / "never fed" / "—" when the clock is unsynced and never fed (montserrat_14 dim, y=+74); default amount "40 g" (montserrat_14, bottom −24). "All cats" entry: three small 88-px avatars side by side and the label "All cats". Prints `[feedme2] idle cat=<name|all> level=<level>` on build.
  - **Amount**: `flow.amountText()` split into number (montserrat_48, centre y −16) and unit (montserrat_14 dim, y +30); "−" / "+" hints left/right; cat name top; hint "PRESS to log · HOLD to cancel" bottom. Prints `[feedme2] amount cat=… mg=…` on rotate.
  - **Fed**: 88-px B3 (grooming) for 2 s then C4, "Logged 40 g for Mochi" (or "for 2 cats"), auto-pops after 2 s (App timer) or on Press. Prints `[feedme2] fed cat=… mg=…`.
  - **History**: 5 rows from `app.feedings().recent(5)` plus each cat's `lastFedAt` from state when the queue is empty: "Mochi · 40 g · 2 h ago"; rotate scrolls; Press dismisses.
  - **System** (`RoundList`): "Wi-Fi", "Pair"/"Unpair", "About", "Sleep now"; Press opens; LongPress back. "Sleep now" → `app.power()` forces LightSleep.
  - **Wi-Fi list**: scan results with RSSI bars; Press on an open network → connect; on a secured one → "Open the setup portal: hold to confirm" → LongPress runs `WifiCaptivePortal::runAndReboot`.
  - **About**: fw version, device id tail, house name, last sync "ok 3 m ago" / "failed: feedings 503", heap.
  - **UnpairConfirm**: "Hold to unpair" with the arc; LongPress handled by App.

- [ ] **Step 2: `main.cpp`**

```cpp
#include <Arduino.h>
#include <TFT_eSPI.h>
#include "adapters/ArduinoClock.h"
#include "adapters/CompositeInput.h"
#include "adapters/Cst816Touch.h"
#include "adapters/EspPower.h"
#include "adapters/EspRandom.h"
#include "adapters/LittleFsQueue.h"
#include "adapters/NvsStorage.h"
#include "adapters/RotaryInput.h"
#include "adapters/SerialLogSink.h"
#include "adapters/WifiStation.h"
#include "adapters/WifiCaptivePortal.h"
#include "application/App.h"
#include "application/Version.h"
#include "screens/ScreenManager.h"
#if SIMULATOR
#include "adapters/FakeNetwork.h"
#include "adapters/SimulatedClock.h"
#include "domain/SimInput.h"
#else
#include "adapters/WifiNetwork.h"
#endif

namespace {
constexpr int kLcdPowerPin = 1;
TFT_eSPI tft;
feedme2::adapters::NvsStorage storage;
feedme2::adapters::LittleFsQueue files;
feedme2::adapters::EspRandom rnd;
feedme2::adapters::SerialLogSink serialSink;
feedme2::adapters::EspPower power(tft);
feedme2::adapters::RotaryInput knob;
feedme2::adapters::Cst816Touch touch;
feedme2::adapters::CompositeInput<feedme2::adapters::RotaryInput, feedme2::adapters::Cst816Touch> input(knob, touch);
#if SIMULATOR
feedme2::adapters::SimulatedClock clock;
feedme2::adapters::FakeNetwork network;
feedme2::adapters::SimInputQueue simInput;   // serial command channel → IInput (wraps domain::parseSimCommand)
#else
feedme2::adapters::ArduinoClock clock;
feedme2::adapters::WifiNetwork network(FEEDME2_BACKEND_URL);
#endif
feedme2::application::App* app = nullptr;
feedme2::screens::ScreenManager* screens = nullptr;

std::string deviceIdFromMac() {
    uint8_t mac[6]; WiFi.macAddress(mac);
    char buf[33]; std::snprintf(buf, sizeof buf, "00000000000000000000%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return buf;
}
}  // namespace

void setup() {
    Serial.begin(115200);
    pinMode(kLcdPowerPin, OUTPUT); digitalWrite(kLcdPowerPin, HIGH); delay(50);
    tft.init(); tft.setRotation(0); tft.fillScreen(TFT_BLACK);
    power.setBacklight(100);
#if !SIMULATOR
    std::string ssid, pass;
    if (!feedme2::adapters::WifiStation::loadCredentials(storage, ssid, pass)) {
        tft.setTextDatum(MC_DATUM); tft.setTextColor(TFT_WHITE, TFT_BLACK);
        tft.drawString("Wi-Fi setup", 120, 90, 4); tft.drawString("join feedme2-XXXX", 120, 130, 2); tft.drawString("from your phone", 120, 150, 2);
        feedme2::adapters::WifiCaptivePortal::runAndReboot(storage);   // [[noreturn]]
    }
    feedme2::adapters::WifiStation::connectInBackground(ssid, pass);   // Idle must render before Wi-Fi joins (spec §5.3)
#endif
    static feedme2::application::App theApp({clock, rnd,
#if SIMULATOR
        simInput,
#else
        input,
#endif
        network, storage, files, power, serialSink, deviceIdFromMac(),
#if SIMULATOR
        "simulator",
#else
        "crowpanel-1.28",
#endif
        feedme2::application::kFirmwareVersion});
    app = &theApp;
    static feedme2::screens::ScreenManager theScreens(theApp, tft);
    screens = &theScreens;
    screens->begin();
    app->begin();
}

void loop() {
    const uint32_t now = millis();
#if SIMULATOR
    simInput.pumpSerial();
#endif
    app->tick(now);
    screens->tick(now);
    delay(5);
}
```

`SimInputQueue` (in `adapters/SimInputQueue.h`, SIMULATOR only) wraps Phase 0's `pollSimInput` logic: reads lines from `Serial`, maps `domain::SimEvent` → `application::InputEvent` (`Touch` → `Press`), queues them for `poll()`, and echoes `[feedme2] input=<Name>` so the existing `boot.scenario.yaml` keeps passing.

- [ ] **Step 3: Build** `pio run -e crowpanel && pio run -e simulator` → both succeed. Run `pio test -e native` → unchanged (≥ 61). If `wokwi-cli` is installed locally, run `wokwi-cli --scenario wokwi/boot.scenario.yaml --timeout 60000 firmware` (optional; CI runs it).

- [ ] **Step 4: Commit**

```bash
git add firmware/src/screens firmware/src/main.cpp firmware/src/adapters/SimInputQueue.h firmware/src/application/Version.h
git commit -m "feat(firmware): lvgl screens — pair, idle with hunger ring, amount, fed, history, system, wifi, about

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
## Task 15: Wokwi scenarios and the HIL-2 CI job

**Files:**
- Create: `firmware/wokwi/feed.scenario.yaml`, `firmware/wokwi/feed_all.scenario.yaml`, `firmware/wokwi/system_menu.scenario.yaml`, `firmware/wokwi/pair.scenario.yaml`
- Modify: `firmware/wokwi/boot.scenario.yaml` (assert the new boot line), `.github/workflows/deploy.yml` (the Wokwi job runs every `firmware/wokwi/*.scenario.yaml` with `wokwi-cli`, uploads `serial.log` per scenario), `firmware/diagram.json` (unchanged parts; confirm the KY-040 and ILI9341 wiring is still right)

**Interfaces:**
- Consumes the serial command channel (`press`, `double`, `long`, `cw`, `ccw`, `touch`) and the `[feedme2] …` event lines from Tasks 6–14 and the `FakeNetwork` (pair code `424242`, confirmed on the third check, state = the sample fixture with cats Mochi and Luna).

- [ ] **Step 1: Scenarios**

`boot.scenario.yaml` (replace):
```yaml
name: 'feedme2 boots unpaired, pairs against the fake api, lands on idle'
version: 1
author: 'feedme2'
steps:
  - wait-serial: '[feedme2] boot ok'
  - wait-serial: '[feedme2] screen=pair'
  - wait-serial: '[feedme2] pair start code=424242'
  - wait-serial: '[feedme2] paired house='
  - wait-serial: '[feedme2] screen=idle'
  - wait-serial: '[feedme2] idle cat=Mochi level='
  - wait-serial: '[feedme2] sync ok accepted=0 state=changed'
```

`feed.scenario.yaml`:
```yaml
name: 'knob feeds the selected cat'
version: 1
author: 'feedme2'
steps:
  - wait-serial: '[feedme2] idle cat=Mochi level='
  - write-serial: "press\n"
  - wait-serial: '[feedme2] screen=amount'
  - write-serial: "cw\n"
  - wait-serial: '[feedme2] amount cat=Mochi mg=45000'
  - write-serial: "press\n"
  - wait-serial: '[feedme2] feeding queued id='
  - wait-serial: '[feedme2] screen=fed'
  - wait-serial: '[feedme2] sync ok accepted=1 state=changed'
  - wait-serial: '[feedme2] idle cat=Mochi level=fed'
```

`feed_all.scenario.yaml`:
```yaml
name: 'all cats logs one feeding per cat with each default'
version: 1
author: 'feedme2'
steps:
  - wait-serial: '[feedme2] idle cat=Mochi level='
  - write-serial: "cw\n"
  - wait-serial: '[feedme2] idle cat=Luna level='
  - write-serial: "cw\n"
  - wait-serial: '[feedme2] idle cat=all level='
  - write-serial: "press\n"
  - wait-serial: '[feedme2] screen=amount'
  - write-serial: "press\n"
  - wait-serial: '[feedme2] feeding queued id='
  - wait-serial: '[feedme2] feeding queued id='
  - wait-serial: '[feedme2] sync ok accepted=2 state=changed'
```

`system_menu.scenario.yaml`:
```yaml
name: 'long press opens the system menu; double tap shows history; long press backs out'
version: 1
author: 'feedme2'
steps:
  - wait-serial: '[feedme2] idle cat=Mochi level='
  - write-serial: "long\n"
  - wait-serial: '[feedme2] screen=system'
  - write-serial: "cw\n"
  - write-serial: "press\n"
  - wait-serial: '[feedme2] screen=unpair'
  - write-serial: "double\n"
  - wait-serial: '[feedme2] screen=system'
  - write-serial: "long\n"
  - wait-serial: '[feedme2] screen=idle'
  - write-serial: "double\n"
  - wait-serial: '[feedme2] screen=history'
  - write-serial: "press\n"
  - wait-serial: '[feedme2] screen=idle'
```

`pair.scenario.yaml`: starts like boot, then `long` → system → select "Unpair" → `long` to confirm → `[feedme2] screen=pair` → `[feedme2] pair start code=424242` again.

- [ ] **Step 2: CI** — the existing `firmware-hil2` job (`.github/workflows/deploy.yml` ~line 360) runs one scenario through `wokwi/wokwi-ci-action@v1`. Change two things: (a) the `firmware-build` job's artifact upload lists `firmware/wokwi/*.scenario.yaml` instead of only `boot.scenario.yaml`; (b) `firmware-hil2` gets a `strategy.matrix.scenario: [boot, pair, feed, feed_all, system_menu]` (`fail-fast: false`), the action step uses `scenario: wokwi/${{ matrix.scenario }}.scenario.yaml`, `timeout: 90000`, `serial_log_file: firmware/serial-${{ matrix.scenario }}.log`, and the upload step names the artifact `wokwi-serial-${{ matrix.scenario }}`. Keep the existing `WOKWI_CLI_TOKEN` presence check (`steps.tok.outputs.have`) so the job skips, not fails, while the secret is unset; say so in `handoff.md`.

- [ ] **Step 3: Local run (optional)** — if `wokwi-cli` is available, run the four scenarios; otherwise the build artefacts (`firmware-merged.bin`, `diagram.json`) must exist after `pio run -e simulator`.

- [ ] **Step 4: Commit**

```bash
git add firmware/wokwi .github/workflows/deploy.yml firmware/src/application/Version.h
git commit -m "test(firmware): wokwi scenarios for pairing, feeding, all cats and the system menu; ci runs them all

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 16: Native test audit to ≥ 100 cases

**Files:**
- Create or extend: `firmware/test/test_domain/test_units.cpp` (formatting edge cases: 0.9999 can → "1 can", 1560 mg can → "0.01 can", oz two decimals, each `fractionText` entry; `snapToStep` with step 0 returns input), `test_hunger.cpp` (each boundary ±1 ms, `levelName` for all six), `test_feedflow.cpp` (max cap, oz unit, scale text for all three, `confirm` twice yields nothing the second time), `test_roster.cpp` (empty roster, `rotate` by large negative), `test_queue.cpp` (`replace`, `head(0)`), `test_router.cpp` (`screenName` for every id), `firmware/test/test_application/test_state_codec.cpp` (cat colour parse of lowercase hex, missing optional fields default, `tzOffsetMin` bounds), `test_sync.cpp` (logs transient requeue; heartbeat failure non-fatal; decode failure keeps old state), `test_power.cpp` (`setSleepTimeoutSec` below 60 clamps to 60), `test_app.cpp` (Fed auto-pops after 2 s; History scroll bounds; rotate on Pair does nothing)
- Modify: both runners

- [ ] **Step 1:** Add the tests above (each a real assertion; no empty tests). **Step 2:** `pio test -e native` → `>= 100 test cases` in the summary line; paste it into the commit body. **Step 3:** Commit `test(firmware): edge cases across domain and application (≥ 100 native cases)`.

---

## Task 17: Docs, full verification, PR

**Files:**
- Modify: `handoff.md` (phase line → "Phase 2b firmware MVP in review", versions, Wokwi note), `README.md` (firmware section: envs, serial command channel, scenarios, how to flash), `CLAUDE.md` (Layout: `firmware/src/{domain,ports,application,adapters,screens,assets}`; rule: domain/application must stay Arduino-free; `fixtures/` consumed by Unity now), `docs/spikes/2026-09-deep-sleep-touch-wake.md` (still open; Phase 3)
- Create: `docs/handoffs/<date>-phase2b-execution-handoff.md`

- [ ] **Step 1: Docs** as listed, including the list of `[feedme2]` event lines (name + fields) as the scenario contract.
- [ ] **Step 2: Full verification**

```bash
pnpm -r typecheck && pnpm -r test && python -m unittest discover -s scripts && (cd firmware && pio test -e native && pio run -e crowpanel && pio run -e simulator) && BASE_REF=origin/main python scripts/check_version_bump.py
```

- [ ] **Step 3: Push and PR** `feat/phase2b-firmware-mvp` → "Phase 2b: firmware MVP" with the spec/plan links, the native case count, the firmware binary size, and the note that Wokwi scenarios run in CI only when `WOKWI_CLI_TOKEN` is set (bench flashing: `pio run -e crowpanel -t upload`).

---

## Self-review against the spec

- §1.2 steps 1–6: Task 10 (Idle/rotate/press/long-press/double-press grammar), Task 14 (screens), Task 8–9 (sync on wake/feeding/timer; queue offline). Step 7 (OTA) is Phase 3.
- §1.5 Units.h + vectors: Task 2. §1.6 Hunger.h + vectors + pose table: Tasks 3, 14. §1.7 white silhouettes 130/88 px as C arrays (D2): Task 13.
- §5.1 layout: Tasks 1–14 produce exactly `domain/ application/ ports/ adapters/ screens/ assets/`. `OtaService`/`IOta` are Phase 3; `IDisplay` is folded into `IPower` (backlight + sleep-in) because LVGL glue lives in `screens/`.
- §5.2 input contract and screen table: Task 10 (App) + Task 14; Update and Login-QR menu entries are Phase 3/5 and are absent from the System menu for now (documented in the handoff).
- §5.3 sync order, cached state before Wi-Fi, `now` corrects the clock: Tasks 3, 8, 14 (`connectInBackground`).
- §5.5 Awake/Dim/Light sleep: Task 9 + 11. Deep sleep + the Q2 spike: Phase 3.
- §5.6 Wi-Fi portal flow: Task 12.
- §5.7 HIL-1 native (≥ 100 now, 150 target later): Task 16; HIL-2 Wokwi scenarios with the serial channel (KY-040 scripting unavailable, as Phase 0 found): Task 15; contract vectors: Tasks 2, 3, 5.
- §6.1 firmware tier bumps on `firmware/` and `fixtures/`: every task stages `Version.h`.
- Review Focus 1–5 → Tasks 9/10, 6/8, 8, 3/8/14, 4/15.
- Types: `InputEvent` (Task 1) is what `IInput` (Task 5), `RotaryInput`/`Cst816Touch` (Task 11) and `App` (Task 10) share; `DeviceState`/`CatState` (Task 4) are what `StateCodec` (Task 5) fills and `CatRoster`/`FeedFlow` (Task 4) and the screens (Task 14) read; `FeedingDraft` (Task 4) is what `FeedingService` (Task 6) persists via `QueueCodec` (Task 5) and `SyncService` (Task 8) posts; `NetResult` (Task 5) is what `WifiNetwork`/`FakeNetwork` (Task 12) return and `PairCoordinator`/`SyncService` (Tasks 7–8) branch on; `PowerTier`/`consumeWakeEvent` (Task 9) is what `App` (Task 10) consults; the `[feedme2]` event lines are produced by Tasks 6, 7, 8, 10, 14 and asserted by Task 15.
