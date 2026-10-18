# Weight stability estimator — bench calibration handoff

This module is a **pure TypeScript reference** for future XIAO firmware. It is not a validated weighing algorithm for a live cat.

## Input and output
- Each sample carries monotonic `atMs`, nonnegative calibrated `grossMg`, and positive `calibrationRevision`.
- Constructor requires `minSamples`, `minDwellMs`, `maxSpreadMg`, `maxSampleGapMs` and `maxGrossMg`. No arbitrary production defaults are embedded.
- A candidate is stable only if at least `minSamples` consecutive readings remain within `maxSpreadMg` over at least `minDwellMs`.
- A sudden mass change, missed-sample gap or calibration revision change restarts the window.
- A sample above the software ceiling returns `overload`; this is **not** a mechanical safety mechanism.
- A stable result uses the median mass, carries the calibration revision and start time, and must not be interpreted as food added or eaten.
- Explicit `reset()` is required on boot/reinitialization and after hardware ADC faults.

## Bench data required before choosing thresholds
1. Zero and empty platform: collect raw and calibrated readings for 30 seconds each, with temperature and power conditions recorded.
2. Register an empty bowl and measure several placements, including slight rotations and shifts.
3. Add known calibration weights in several increments within the load-cell safe range; verify accuracy and linearity.
4. Test off-center placements in each of the four platform quadrants; record maximum bias and structural deflection.
5. Measure settling after lifting/returning the bowl, after food is added, and after table vibrations.
6. Verify startup/reboot, power interruption, missing HX711 readings and calibration revision change.
7. Verify actual overload stops **before any pet interaction**. Never rely on software overload detection to protect the 1 kg cell.

Select `maxSpreadMg` from measured noise, `minDwellMs` from observed settling time, and `maxSampleGapMs` from actual sampling cadence. Document the chosen parameters, device firmware version and measured error bounds. Do not claim a universal 3–5 second stable-weight threshold without these measurements.

## Limitations
- This algorithm detects stable windows only; it does not detect bowl presence, select bowl profiles or infer a food addition.
- A slow drift can remain within the window and produce a stable result. Cross-check against periodic calibration and known reference weights.
- After 256 samples the median uses the newest 256; the original candidate start time and conservative min/max are retained.
- Hardware implementation must reproduce these behaviors with native C++ tests and cross-language fixture vectors.
