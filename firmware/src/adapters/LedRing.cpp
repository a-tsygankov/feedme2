#include "adapters/LedRing.h"

#include <Arduino.h>

namespace feedme2::adapters {

namespace {

uint8_t scaleChan(uint8_t c, uint8_t bright) {
    return static_cast<uint8_t>((static_cast<uint16_t>(c) * bright) / 255);
}

}  // namespace

void LedRing::ensureBegun() {
    if (begun_) return;
    begun_ = true;
    pinMode(kRailPin, OUTPUT);
    digitalWrite(kRailPin, HIGH);
    delay(5);  // let the rail settle before the first 800 kHz frame
    pixels_.begin();
    pixels_.setBrightness(255);  // scaled per call instead; setBrightness is lossy
    pixels_.clear();
    pixels_.show();
}

void LedRing::set(uint32_t rgb, uint8_t brightness) {
    ensureBegun();
    const uint8_t r = scaleChan(static_cast<uint8_t>(rgb >> 16), brightness);
    const uint8_t g = scaleChan(static_cast<uint8_t>(rgb >> 8), brightness);
    const uint8_t b = scaleChan(static_cast<uint8_t>(rgb), brightness);
    const uint32_t color = Adafruit_NeoPixel::Color(r, g, b);
    for (uint16_t i = 0; i < kLedCount; ++i) pixels_.setPixelColor(i, color);
    pixels_.show();
}

}  // namespace feedme2::adapters
