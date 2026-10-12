#include "adapters/Cst816Touch.h"

#include <Arduino.h>
#include <Wire.h>

namespace feedme2::adapters {

namespace {

constexpr uint8_t kI2cAddr = 0x15;
constexpr uint8_t kRegFingerNum = 0x02;
constexpr uint8_t kRegXposH = 0x03;

uint8_t readReg(uint8_t reg) {
    Wire.beginTransmission(kI2cAddr);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return 0;
    if (Wire.requestFrom(kI2cAddr, static_cast<uint8_t>(1)) != 1) return 0;
    return static_cast<uint8_t>(Wire.read());
}

// XposH/XposL/YposH/YposL; the top nibble of each high byte is event flags.
bool readTouchPos(int& x, int& y) {
    Wire.beginTransmission(kI2cAddr);
    Wire.write(kRegXposH);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(kI2cAddr, static_cast<uint8_t>(4)) != 4) return false;
    const uint8_t xh = static_cast<uint8_t>(Wire.read());
    const uint8_t xl = static_cast<uint8_t>(Wire.read());
    const uint8_t yh = static_cast<uint8_t>(Wire.read());
    const uint8_t yl = static_cast<uint8_t>(Wire.read());
    x = (static_cast<int>(xh & 0x0F) << 8) | xl;
    y = (static_cast<int>(yh & 0x0F) << 8) | yl;
    return true;
}

int absInt(int v) { return v < 0 ? -v : v; }

}  // namespace

void Cst816Touch::begin() {
    // Hardware reset so the controller is in a known state after a warm boot.
    pinMode(kPinRst, OUTPUT);
    digitalWrite(kPinRst, LOW);
    delay(20);
    digitalWrite(kPinRst, HIGH);
    delay(50);

    Wire.setPins(kPinSda, kPinScl);
    Wire.begin();
    Wire.setClock(400000);

    // INT is not used by the polling path, but it is a light-sleep wake source
    // (EspPower::lightSleep), so keep it pulled up and configured as an input.
    pinMode(kPinInt, INPUT_PULLUP);
}

application::InputEvent Cst816Touch::poll() {
    using application::InputEvent;
    const uint32_t now = millis();
    if (now - lastPollMs_ < kPollIntervalMs) return InputEvent::None;
    lastPollMs_ = now;

    const bool touching = readReg(kRegFingerNum) > 0;

    if (touching && !touching_) {
        touching_ = true;
        longFired_ = false;
        touchStartMs_ = now;
        startX_ = startY_ = lastX_ = lastY_ = -1;
        if (readTouchPos(lastX_, lastY_)) { startX_ = lastX_; startY_ = lastY_; }
        return InputEvent::None;
    }

    if (touching && touching_) {
        int x = -1, y = -1;
        if (readTouchPos(x, y)) { lastX_ = x; lastY_ = y; }
        if (!longFired_ && (now - touchStartMs_) >= kLongPressMs) {
            longFired_ = true;
            return InputEvent::LongPress;
        }
        return InputEvent::None;
    }

    if (!touching && touching_) {
        touching_ = false;
        if (longFired_) return InputEvent::None;  // LongPress already delivered mid-hold
        const bool haveStart = startX_ >= 0 && startY_ >= 0;
        const int dx = haveStart ? lastX_ - startX_ : 0;
        const int dy = haveStart ? lastY_ - startY_ : 0;
        const int absDx = absInt(dx);
        const int absDy = absInt(dy);
        // X grows left to right: a finger moving right is SwipeRight. Diagonal
        // flicks (off-axis travel larger than on-axis) are neither swipe nor tap.
        if (absDx >= kSwipeMinPx && absDy <= absDx) {
            return dx < 0 ? InputEvent::SwipeLeft : InputEvent::SwipeRight;
        }
        const uint32_t heldMs = now - touchStartMs_;
        if (heldMs < kTapMaxMs && absDx < kTapMaxTravelPx && absDy < kTapMaxTravelPx) {
            return InputEvent::Press;
        }
    }
    return InputEvent::None;
}

}  // namespace feedme2::adapters
