#pragma once

// Serial input channel for the Wokwi simulator (spec §5.7). Wokwi's
// KY-040 part exposes no scriptable control, so under -DSIMULATOR=1
// main.cpp reads one command per line from Serial and turns it into
// the same input event a knob or touch would produce. Scenarios
// (firmware/wokwi/*.scenario.yaml) drive it with `write-serial`.

#include <cctype>
#include <string>

namespace feedme2::domain {

enum class SimEvent { None, Press, DoubleTap, LongPress, RotateCW, RotateCCW, Touch };

inline SimEvent parseSimCommand(const std::string& raw) {
    std::string s;
    for (char c : raw) {
        if (std::isspace(static_cast<unsigned char>(c))) continue;
        s.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    if (s == "press") return SimEvent::Press;
    if (s == "double") return SimEvent::DoubleTap;
    if (s == "long") return SimEvent::LongPress;
    if (s == "cw") return SimEvent::RotateCW;
    if (s == "ccw") return SimEvent::RotateCCW;
    if (s == "touch") return SimEvent::Touch;
    return SimEvent::None;
}

inline const char* simEventName(SimEvent e) {
    switch (e) {
        case SimEvent::Press: return "Press";
        case SimEvent::DoubleTap: return "DoubleTap";
        case SimEvent::LongPress: return "LongPress";
        case SimEvent::RotateCW: return "RotateCW";
        case SimEvent::RotateCCW: return "RotateCCW";
        case SimEvent::Touch: return "Touch";
        case SimEvent::None: break;
    }
    return "None";
}

}  // namespace feedme2::domain
