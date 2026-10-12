#pragma once

#include <Arduino.h>

#include "ports/IInput.h"

namespace feedme2::adapters {

// CrowPanel quadrature encoder + push button, polled from loop().
// Pins (verified on this board by howler's pin probe; GPIO 5/6/7 are the
// CST816D, not the encoder): A = GPIO 45, B = GPIO 42, SW = GPIO 41 (active
// LOW, internal pull-up). The encoder is a 4-edge-per-detent type, so the
// accumulator threshold ±4 maps one mechanical click to one Rotate event.
//
// Button grammar (spec §5.2): LongPress fires eagerly once held >= 600 ms so
// the perimeter arc has an endpoint while the finger is still down; the
// release after it is silent. A short release is deferred kDoubleTapMs so a
// second click inside the window upgrades it to DoubleTap; otherwise Press.
class RotaryInput final : public ports::IInput {
public:
    static constexpr int kPinA = 45;
    static constexpr int kPinB = 42;
    static constexpr int kPinButton = 41;
    static constexpr uint32_t kLongPressMs = 600;
    static constexpr uint32_t kDoubleTapMs = 350;

    void begin() {
        pinMode(kPinA, INPUT_PULLUP);
        pinMode(kPinB, INPUT_PULLUP);
        pinMode(kPinButton, INPUT_PULLUP);
        prev_ = readState();
    }

    application::InputEvent poll() override {
        using application::InputEvent;
        const uint32_t now = millis();

        // 0. A deferred short tap that outlived the double-tap window is a Press.
        if (pendingTap_ && (now - lastTapEndMs_) >= kDoubleTapMs) {
            pendingTap_ = false;
            return InputEvent::Press;
        }

        // 1. Rotation: standard quadrature transition table indexed by prev|curr.
        //    Zero entries are no-change or illegal double edges (contact bounce).
        const uint8_t curr = readState();
        accumulator_ += kDelta[(prev_ << 2) | curr];
        prev_ = curr;
        if (accumulator_ >= 4) { accumulator_ = 0; return InputEvent::RotateCW; }
        if (accumulator_ <= -4) { accumulator_ = 0; return InputEvent::RotateCCW; }

        // 2. Button.
        const bool pressed = digitalRead(kPinButton) == LOW;
        if (pressed && !wasPressed_) {
            wasPressed_ = true;
            longFired_ = false;
            pressStartedMs_ = now;
        } else if (pressed && wasPressed_) {
            if (!longFired_ && (now - pressStartedMs_) >= kLongPressMs) {
                longFired_ = true;
                pendingTap_ = false;
                return InputEvent::LongPress;
            }
        } else if (!pressed && wasPressed_) {
            wasPressed_ = false;
            if (longFired_) {
                longFired_ = false;  // the person already got LongPress mid-hold
                return InputEvent::None;
            }
            if (pendingTap_ && (now - lastTapEndMs_) < kDoubleTapMs) {
                pendingTap_ = false;
                return InputEvent::DoubleTap;
            }
            pendingTap_ = true;
            lastTapEndMs_ = now;
        }
        return InputEvent::None;
    }

    bool isHeld() const override { return wasPressed_; }

private:
    static constexpr int8_t kDelta[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};

    static uint8_t readState() {
        return static_cast<uint8_t>((digitalRead(kPinA) << 1) | digitalRead(kPinB));
    }

    uint8_t prev_ = 0;
    int8_t accumulator_ = 0;
    bool wasPressed_ = false;
    bool longFired_ = false;
    bool pendingTap_ = false;
    uint32_t pressStartedMs_ = 0;
    uint32_t lastTapEndMs_ = 0;
};

}  // namespace feedme2::adapters
