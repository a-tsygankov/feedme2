#pragma once
#include <cstdint>

namespace feedme2::application {

// The knob grammar (spec §5.2). Touch is folded into the same events by
// CompositeInput: tap = Press, horizontal swipe = rotate.
enum class InputEvent : uint8_t { None, RotateCW, RotateCCW, Press, DoubleTap, LongPress, SwipeLeft, SwipeRight };

inline const char* eventName(InputEvent e) {
    switch (e) {
        case InputEvent::RotateCW: return "RotateCW";
        case InputEvent::RotateCCW: return "RotateCCW";
        case InputEvent::Press: return "Press";
        case InputEvent::DoubleTap: return "DoubleTap";
        case InputEvent::LongPress: return "LongPress";
        case InputEvent::SwipeLeft: return "SwipeLeft";
        case InputEvent::SwipeRight: return "SwipeRight";
        case InputEvent::None: break;
    }
    return "None";
}

}  // namespace feedme2::application
