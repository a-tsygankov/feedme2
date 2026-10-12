#pragma once
#include <cstdint>

namespace feedme2::ports {

class IPower {
public:
    virtual ~IPower() = default;
    virtual void setBacklight(uint8_t percent) = 0;
    virtual void displaySleep(bool on) = 0;
    virtual void lightSleep(uint32_t maxMs) = 0;
    virtual void ledRing(uint32_t rgb, uint8_t brightness) = 0;
};

}  // namespace feedme2::ports
