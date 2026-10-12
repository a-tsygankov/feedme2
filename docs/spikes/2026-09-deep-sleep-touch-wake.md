# Spike: deep-sleep touch wake on the CrowPanel 1.28"

Question (spec §0 Q2, §5.5): can a CST816D touch (INT on GPIO 5) wake the
ESP32-S3 from deep sleep, and is the touch controller powered from the
always-on 3V3 rail or from the GPIO 1-switched LCD rail?

Firmware: `firmware/src/spike/sleep_touch/main.cpp`, env `spike-sleep`.

## Procedure
1. `cd firmware && pio run -e spike-sleep -t upload && pio device monitor`
2. While awake (10 s), touch the screen: the `touch INT=` line should show `0` pulses.
3. Wait for `deep sleep now`, then touch the screen; try 2–3 separate touches before concluding that touch cannot wake it. Read the next boot's `cause=`.
4. Edit `platformio.ini` `[env:spike-sleep]` to `-DSPIKE_HOLD_LCD_RAIL=1`, repeat 1–3.
5. If a USB power meter is available, note the sleeping current for each run.

## Results
| Run | INT pulses while awake | Wake cause after touch | Sleep current |
|---|---|---|---|
| hold_rail=0 | | | |
| hold_rail=1 | | | |

## Conclusion
(Which rail powers the touch controller; whether ext0 wake works; which of the
§5.5 fallbacks Phase 3 must take.)

Note: ext0 wake keeps the RTC_PERIPH power domain on, so the measured sleep current includes that overhead; Phase 3 can revisit ext1 if the idle budget is tight.

Status: bench run not yet performed (no board attached on 2026-09-20).

## 2026-10-12 — still open (Phase 3); a spec correction from Phase 2b

The spike is still open: Phase 2b (firmware MVP) stops at light sleep and never runs the deep-sleep path, so Q2 (touch-controller rail, ext0 wake) is a Phase 3 item together with deep sleep itself. The `spike-sleep` env and this procedure are unchanged.

Correction to spec §5.5, found while implementing `EspPower::lightSleep` (not a spec edit; the spec keeps its wording until Phase 3 revisits §5.5): **a manual `esp_light_sleep_start()` drops the Wi-Fi association.** Only esp_pm's automatic light sleep coordinates with the modem's sleep, so the §5.5 line "light sleep keeps the Wi-Fi association and RAM" holds for RAM but not for Wi-Fi. The Phase 2b firmware accepts this: `main.cpp` calls `WifiStation::ensureConnected()` after every wake (and once a second while awake), the first sync round after a wake may stop as transient and `SyncService` retries after 60 s. The USB-CDC console drops across the sleep too. When Phase 3 measures the bench unit, record here whether esp_pm's automatic light sleep (`CONFIG_PM_ENABLE` + `esp_pm_configure` with `light_sleep_enable`) can replace the manual call and keep the association, and what it costs in idle current.
