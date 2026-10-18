# XIAO bowl lift/return detector — USB-supervised experiment

The pure C++ `BowlLiftDetector` (`firmware/src/domain/BowlLiftDetector.h`) processes **only stable, calibrated gross weights** from `WeightStabilityEstimator`. It is the firmware counterpart of the `shared/src/scale.ts` lift/return idea, not a complete food-addition or feeding system.

## Explicit operator setup

Use `xiao-scale-net` with a real HX711, measured calibration and a known bowl. First complete `zero`, `ref`, `limit`, `commit`, `tune`, `run`, Wi-Fi/NTP and pairing as documented in [secure network bench](xiao-secure-network-bench.md). With the platform unloaded and the bowl present, **measure both stable mass ranges**. Pick thresholds separated by a large noise gap:

```text
watch <absent_at_or_below_mg> <present_at_or_above_mg> <max_lift_ms>
watch off
```

Example **for illustration only**, not calibrated hardware settings: `watch 5000 60000 300000`. Thresholds must be established from actual bench readings; the upper threshold must be lower than the smallest measured gross bowl mass, and the lower threshold above the largest measured empty-platform noise. There are no production defaults. The watch is **off after every reboot** and stops on calibration changes, ADC faults, loss of pairing, queue write failure, or a lift timeout.

## State transitions

- `Unknown` → `Empty` or `Present` establishes the first stable baseline; it never produces an inferred addition.
- `Present` → `Lifted` only after a **stable** mass below the absent threshold. Queues `bowl_removed`.
- `Lifted` → `Present` only after a **stable** mass above the present threshold, before the configured timeout. Queues `bowl_returned` with the new gross mass.
- Values between thresholds do not change state. No repeated event is emitted for repeated stable samples.
- Sensor fault, calibration revision change, monotonic-time reversal or lift timeout invalidates the transition. After a reboot the detector starts in `Unknown`, never replaying an unverified lift.
- A returned bowl yields `deltaMg = afterGrossMg - beforeGrossMg` on USB, explicitly **REVIEW-ONLY**. Zero/negative deltas are not food added. Positive deltas are also unverified: gross mass alone cannot establish bowl identity or distinguish swapped bowls. **No feeding or food-addition records are created.**

Events use the existing authenticated `/api/device/scale-events` protocol, not `/api/device/feedings`. Existing pairing-epoch queue isolation, retry, and 201 acknowledgment rules apply. If the queue append fails, the watch disables rather than continuing to count transitions that cannot be persisted. The `record` command remains available separately for manual `stable_weight` samples.

## Testing and remaining gates

- Native Unity tests: first placement, positive/negative/zero deltas, hysteresis, one-shot event emission, fault, recalibration, timeout, reboot, invalid inputs, and serialized queue/ack.
- GitHub CI compiles `xiao-scale-net`, but this does **not** validate physical HX711 noise, mechanical load path, bowl-lift thresholds, camera identification or false-positive rate.
- **No unattended pet use** until calibrated physical overload stops and a safe load path are installed and tested.
- Production food-addition logic still requires independent bowl identification, persisted sequence processing, review UI, duplicate/restart reconciliation, and real bench trials. A gross weight delta is never proof of consumption.
