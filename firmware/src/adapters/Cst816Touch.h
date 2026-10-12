#pragma once

#include <cstdint>

#include "ports/IInput.h"

namespace feedme2::adapters {

// CST816D capacitive touch on the CrowPanel 1.28": I²C 0x15 on SDA 6 / SCL 7,
// RST 13, INT 5. The chip's gesture register reports 0x0C for every touch on
// this panel variant (feedme/howler footnote), so gestures are synthesised in
// software from the finger-count register (0x02) and the XY registers (0x03)
// polled at ~50 Hz:
//   tap   (< 300 ms, < 10 px travel)  → Press
//   swipe (horizontal, >= 36 px)      → SwipeLeft / SwipeRight (rotate)
//   hold  (>= 600 ms)                 → LongPress, fired eagerly while held
// There is no touch DoubleTap: the knob owns that gesture.
//
// begin() must run after any other Wire user is decided: Wire's pin
// assignment is global and a later Wire.begin() would override it.
class Cst816Touch final : public ports::IInput {
public:
    static constexpr int kPinSda = 6;
    static constexpr int kPinScl = 7;
    static constexpr int kPinRst = 13;
    static constexpr int kPinInt = 5;

    static constexpr uint32_t kPollIntervalMs = 20;  // ~50 Hz
    static constexpr uint32_t kTapMaxMs = 300;
    static constexpr int kTapMaxTravelPx = 10;
    static constexpr int kSwipeMinPx = 36;
    static constexpr uint32_t kLongPressMs = 600;

    void begin();
    application::InputEvent poll() override;
    bool isHeld() const override { return touching_; }

private:
    bool touching_ = false;
    bool longFired_ = false;
    uint32_t touchStartMs_ = 0;
    uint32_t lastPollMs_ = 0;
    int startX_ = -1;
    int startY_ = -1;
    int lastX_ = -1;
    int lastY_ = -1;
};

}  // namespace feedme2::adapters
