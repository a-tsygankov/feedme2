#include "adapters/Hx711Scale.h"

namespace feedme2::adapters {

void Hx711Scale::begin() {
    pinMode(dout_, INPUT);
    pinMode(clock_, OUTPUT);
    digitalWrite(clock_, LOW);
}

bool Hx711Scale::readRaw(int32_t& raw) {
    if (digitalRead(dout_) != LOW) return false;
    uint32_t bits = 0;
    // HX711 power-down is triggered if SCK stays high >60 us. Protect
    // each 25-pulse transaction from ISR preemption on this core.
    portENTER_CRITICAL(&mux_);
    if (digitalRead(dout_) != LOW) {
        portEXIT_CRITICAL(&mux_);
        return false;
    }
    for (uint8_t i = 0; i < 24; ++i) {
        digitalWrite(clock_, HIGH);
        delayMicroseconds(1);
        bits = (bits << 1) | static_cast<uint32_t>(digitalRead(dout_) == HIGH);
        digitalWrite(clock_, LOW);
        delayMicroseconds(1);
    }
    // Pulse 25 selects channel A, gain 128 for the next conversion.
    digitalWrite(clock_, HIGH);
    delayMicroseconds(1);
    digitalWrite(clock_, LOW);
    portEXIT_CRITICAL(&mux_);
    if (bits & 0x800000u) bits |= 0xff000000u;
    raw = static_cast<int32_t>(bits);
    return true;
}

}  // namespace feedme2::adapters
