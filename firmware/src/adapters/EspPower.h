#pragma once

#include <TFT_eSPI.h>

#include <cstdint>

#include "adapters/LedRing.h"
#include "ports/IPower.h"

namespace feedme2::adapters {

// Power tiers for the CrowPanel (spec §5.5), driven by application::PowerManager.
// Takes the TFT_eSPI instance main.cpp already initialised (DC=3 on this board,
// not the TFT_eSPI default 8; the LCD rail GPIO 1 must already be HIGH).
class EspPower final : public ports::IPower {
public:
    static constexpr int kBacklightPin = 46;
    static constexpr uint8_t kLedcChannel = 0;
    static constexpr uint32_t kLedcFreqHz = 5000;
    static constexpr uint8_t kLedcBits = 8;

    explicit EspPower(TFT_eSPI& tft) : tft_(tft) {}

    // 0..100 % via LEDC PWM on BL 46 (TFT_eSPI drives it as a plain GPIO at
    // init; the first call re-attaches the pin to the PWM channel).
    void setBacklight(uint8_t percent) override;
    // GC9A01 sleep-in (0x10) / sleep-out (0x11). Sleep-out needs 120 ms before
    // the panel accepts the next command (datasheet), hence the delay.
    void displaySleep(bool on) override;
    // Light sleep until a wake pin (RotaryInput button/A, Cst816Touch INT)
    // goes active or maxMs elapses. RAM survives and resume is < 100 ms, but
    // the Wi-Fi association and the USB-CDC console do not: the next sync
    // reconnects first (see the .cpp).
    void lightSleep(uint32_t maxMs) override;
    void ledRing(uint32_t rgb, uint8_t brightness) override { ring_.set(rgb, brightness); }

private:
    TFT_eSPI& tft_;
    LedRing ring_;
    bool pwmAttached_ = false;
};

}  // namespace feedme2::adapters
