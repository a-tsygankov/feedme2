#pragma once

#include <Arduino.h>

#include "ports/IClock.h"

#ifndef FEEDME2_SIM_SPEED
#define FEEDME2_SIM_SPEED 1
#endif

namespace feedme2::adapters {

// Monotonic clock for the Wokwi simulator (-DSIMULATOR=1). Scales millis() by
// kSimSpeed so a scenario can watch a hunger arc fill in seconds instead of
// hours (-DFEEDME2_SIM_SPEED=60). The scaled value wraps after 2^32 / speed
// ms, far beyond any scenario's runtime; domain code uses unsigned deltas and
// is unaffected anyway. Wall time still comes from the server `now` (here:
// FakeNetwork), exactly like ArduinoClock on hardware.
class SimulatedClock final : public ports::IClock {
public:
    static constexpr uint32_t kSimSpeed = FEEDME2_SIM_SPEED;
    static_assert(kSimSpeed >= 1, "FEEDME2_SIM_SPEED must be >= 1");

    uint32_t monotonicMs() override { return millis() * kSimSpeed; }
};

}  // namespace feedme2::adapters
