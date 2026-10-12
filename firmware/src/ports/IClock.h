#pragma once
#include <cstdint>

namespace feedme2::ports {

class IClock {
public:
    virtual ~IClock() = default;
    // Milliseconds since boot. Wall-clock time is derived by domain::ClockModel
    // from the server's `now`, never read from here (an RTC that lost power lies).
    virtual uint32_t monotonicMs() = 0;
};

}  // namespace feedme2::ports
