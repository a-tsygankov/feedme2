#pragma once
#include <cstdint>

namespace feedme2::domain {

// Hold-to-confirm progress (spec §5.2 "LongPress 600 ms, perimeter arc").
// Cosmetic: the input adapter fires the real LongPress event.
class LongPressArc {
public:
    explicit LongPressArc(uint32_t holdMs = 600) : holdMs_(holdMs) {}
    void update(uint32_t nowMs, bool held) {
        if (!held) { charging_ = false; percent_ = 0; return; }
        if (!charging_) { charging_ = true; startMs_ = nowMs; }
        const uint32_t elapsed = nowMs - startMs_;
        percent_ = elapsed >= holdMs_ ? 100 : static_cast<int>(elapsed * 100 / holdMs_);
    }
    int percent() const { return percent_; }
    bool charging() const { return charging_; }

private:
    uint32_t holdMs_;
    uint32_t startMs_ = 0;
    bool charging_ = false;
    int percent_ = 0;
};

}  // namespace feedme2::domain
