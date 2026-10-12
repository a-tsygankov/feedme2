#pragma once

#include <Arduino.h>

#include "ports/IClock.h"

namespace feedme2::adapters {

// Monotonic time only. Wall-clock time is never read here: the CrowPanel has
// no battery-backed RTC, so after a power cut the ESP32 boots in 1970 and a
// feeding stamped from it would show "fed 56 years ago" (Review Focus 4).
// domain::ClockModel derives wall time from the server's `now` instead.
class ArduinoClock final : public ports::IClock {
public:
    uint32_t monotonicMs() override { return millis(); }
};

}  // namespace feedme2::adapters
