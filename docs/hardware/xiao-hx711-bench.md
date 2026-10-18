# XIAO ESP32S3 Sense + HX711: isolated scale bench firmware

**Status:** USB bench prototype only. No pairing, camera capture, cloud upload, food inference, automatic tare or unattended pet operation. The existing CrowPanel firmware remains unchanged.

## Hardware and wiring

Target: Seeed Studio **XIAO ESP32S3 Sense** and a separate **HX711** breakout attached to the 1 kg load cell.

| HX711 | XIAO Sense | ESP32-S3 |
| --- | --- | --- |
| VCC | 3V3 | regulated 3.3 V |
| GND | GND | common ground |
| DT / DOUT | D0 | GPIO1 |
| SCK / CLK | D1 | GPIO2 |

The two GPIO assignments are explicitly configured in `firmware/platformio.ini` under `xiao-scale-bench`. D4/D5 are left free for a future NAU7802 I2C option. Avoid D2/GPIO3 because it is a boot strapping pin. These GPIOs do not overlap the Sense camera's documented pins. Verify the HX711 breakout is 3.3 V compatible and confirm the load-cell E+/E-/A+/A- wiring from its own datasheet before power-on. **Never connect HX711 5 V digital outputs directly to XIAO 3.3 V inputs.**

Seeed pin map: https://wiki.seeedstudio.com/xiao_esp32s3_pin_multiplexing/

## Build and flash

From `firmware/`:

```bash
pio test -e native
pio run -e xiao-scale-bench
pio run -e xiao-scale-bench -t upload
pio device monitor -b 115200
```

CI builds this target and runs the native tests. There is **no camera, Wi-Fi, network token or cloud telemetry** in the bench image.

## Operator-only calibration sequence

1. Power the XIAO from USB, **with no cat near the mechanism**. Type `help` and `status`. The serial console prints raw ADC counts every 500 ms.
2. With the unloaded, mechanically assembled platform at known zero, wait for readings to settle and type `zero`. It captures the most recent raw sample.
3. Place a **known calibration mass** within the load-cell's rated range, wait for settling and type `ref 100000` (example: a certified **100 g** reference mass; the command argument is in milligrams).
4. Determine a conservative **software gross-mass limit** from mechanical and electrical bench testing. Type `limit <mass_mg>` (for example, `limit 800000` is **not** a validated universal setting). The firmware refuses a limit above 1,000,000 mg. This limit **does not protect the cell against physical overload**.
5. Type `commit`. It increments the calibration revision and writes an integrity-checked record to NVS. If any capture is missing, or the reference/zero readings coincide, the commit is rejected.
6. Measure noise, sampling cadence and settling times. Set explicit parameters using `tune <min_samples> <dwell_ms> <spread_mg> <max_gap_ms>`. Example **for software demonstration only**, not for production: `tune 3 2000 100 1500`.
7. Type `run` to print stable mass estimates. Type `stop` to stop stability detection; `clear` removes the persisted calibration.

**No `tare` command exists.** An unknown bowl with food must not be silently zeroed. Re-capturing `zero` invalidates the pending reference, requiring a new `ref` capture.

## What is and is not verified

- Host Unity tests exercise C++ median stability, dwell, gaps, noise, calibration revision, software overload, invalid samples and two-point calibration.
- The reference algorithm is derived from `shared/src/weight-stability.ts`. It is not yet a native C++/TypeScript machine-generated vector comparison. Host tests cover corresponding known scenarios.
- GPIO sampling is non-blocking while the HX711 is not ready; a 1.5-second timeout prints an ADC fault and resets stability. Serial output is for diagnosis only.
- Sensor saturation, negative mass and software overload produce errors rather than a feeding.
- Physical fit, corner loading, vibration, cable strain, HX711 analog noise, temperature drift, NVS endurance, overload stops and real XIAO/camera coexistence **still require bench testing**.
- Hardware-specific `xiao-scale-bench` compilation is checked by CI, but a passing build is not a physical test.

## Follow-up

Next firmware slice: durable scale-event outbox with monotonically increasing per-pairing sequence numbers, UUIDs, HTTP authentication and `POST /api/device/scale-events`; do not acknowledge or delete queued observations on transient network failures. The endpoint's 201 means all events were persisted or already present, even when `accepted` is empty. Hardware firmware must keep its own pairing epoch separate from the legacy CrowPanel firmware. Integrate the Sense camera only after measuring actual PCB/FPC fit.
