#pragma once
#include "application/Events.h"

namespace feedme2::ports {

class IInput {
public:
    virtual ~IInput() = default;
    virtual application::InputEvent poll() = 0;
    // True while the knob button or the touch panel is physically held (drives the long-press arc).
    virtual bool isHeld() const = 0;
};

}  // namespace feedme2::ports
