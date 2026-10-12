#include "adapters/LedRing.h"

#include <Arduino.h>

namespace feedme2::adapters {

namespace {

uint8_t scaleChan(uint8_t c, uint8_t bright) {
    return static_cast<uint8_t>((static_cast<uint16_t>(c) * bright) / 255);
}

}  // namespace

void LedRing::ensureBegun() {
    if (!begun_) {
        begun_ = true;
        pinMode(kRailPin, OUTPUT);
        pixels_.begin();
        pixels_.setBrightness(255);  // scaled per call instead; setBrightness is lossy
    }
    if (railOn_) return;
    digitalWrite(kRailPin, HIGH);
    railOn_ = true;
    delay(5);  // let the rail settle before the first 800 kHz frame
    pixels_.clear();
    pixels_.show();
}

void LedRing::set(uint32_t rgb, uint8_t brightness) {
    if (brightness == 0) {
        // Spec §5.5: light sleep means "LED off", and an unpowered rail is the
        // only state in which the WS2812s draw nothing (a black frame still
        // leaves each chip's quiescent current). Clear the frame first so the
        // strip comes back dark when the rail is raised again.
        if (railOn_) {
            pixels_.clear();
            pixels_.show();
            digitalWrite(kRailPin, LOW);
            railOn_ = false;
        }
        return;
    }
    ensureBegun();
    const uint8_t r = scaleChan(static_cast<uint8_t>(rgb >> 16), brightness);
    const uint8_t g = scaleChan(static_cast<uint8_t>(rgb >> 8), brightness);
    const uint8_t b = scaleChan(static_cast<uint8_t>(rgb), brightness);
    const uint32_t color = Adafruit_NeoPixel::Color(r, g, b);
    for (uint16_t i = 0; i < kLedCount; ++i) pixels_.setPixelColor(i, color);
    pixels_.show();
}

}  // namespace feedme2::adapters
