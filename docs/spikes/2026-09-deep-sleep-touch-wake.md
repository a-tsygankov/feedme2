# Spike: deep-sleep touch wake on the CrowPanel 1.28"

Question (spec §0 Q2, §5.5): can a CST816D touch (INT on GPIO 5) wake the
ESP32-S3 from deep sleep, and is the touch controller powered from the
always-on 3V3 rail or from the GPIO 1-switched LCD rail?

Firmware: `firmware/src/spike/sleep_touch/main.cpp`, env `spike-sleep`.

## Procedure
1. `cd firmware && pio run -e spike-sleep -t upload && pio device monitor`
2. While awake (10 s), touch the screen: the `touch INT=` line should show `0` pulses.
3. Wait for `deep sleep now`, then touch the screen. Read the next boot's `cause=`.
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

Status: bench run not yet performed (no board attached on 2026-09-20).
