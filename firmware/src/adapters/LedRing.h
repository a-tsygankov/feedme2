#pragma once

#include <Adafruit_NeoPixel.h>

#include <cstdint>

namespace feedme2::adapters {

// 5 × WS2812 under the CrowPanel bezel, data on GPIO 48. Not a port by itself:
// EspPower owns one and exposes it through IPower::ledRing(). CrowPanel quirk:
// the LED rail is switched by GPIO 2 and must be driven HIGH before the first
// show(), otherwise the strip is unpowered and every write is silently lost.
// The rail is raised lazily on first use so a device that never lights the
// ring (e.g. the Pair screen before a house exists) does not pay for it.
class LedRing {
public:
    static constexpr int kDataPin = 48;
    static constexpr int kRailPin = 2;
    static constexpr uint16_t kLedCount = 5;

    // rgb = 0xRRGGBB; brightness 0..255 scales every channel. 0 turns the ring off.
    void set(uint32_t rgb, uint8_t brightness);

private:
    void ensureBegun();

    Adafruit_NeoPixel pixels_{kLedCount, kDataPin, NEO_GRB + NEO_KHZ800};
    bool begun_ = false;
};

}  // namespace feedme2::adapters
