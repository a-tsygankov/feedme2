#pragma once

#include <Arduino.h>
#include <freertos/FreeRTOS.h>

namespace feedme2::adapters {

// HX711 channel A, gain 128, non-blocking poll. GPIO is assigned by the
// xiao-scale-bench PlatformIO env (XIAO D2/D3); never use camera pins.
// A returned false means DOUT is not ready, not a zero-weight reading.
class Hx711Scale {
public:
    Hx711Scale(uint8_t doutPin, uint8_t clockPin) : dout_(doutPin), clock_(clockPin) {}
    void begin();
    bool readRaw(int32_t& raw);

private:
    uint8_t dout_;
    uint8_t clock_;
    portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
};

}  // namespace feedme2::adapters
