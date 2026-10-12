#pragma once
// Mirror of shared/src/hunger.ts (spec §1.6), pinned by fixtures/hunger-vectors.json.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

namespace feedme2::domain {

enum class HungerLevel : uint8_t { Fed, Content, Peckish, Hungry, VeryHungry, Starving };
enum class LevelColor : uint8_t { Good, Warn, Danger };

constexpr int32_t kFedWindowSec = 900;

struct HungerState {
    HungerLevel level;
    double ratio;   // age / hungryAfter; +inf when never fed
    double ageSec;  // clamped >= 0; +inf when never fed
};

inline HungerState hungerState(int64_t nowMs, const int64_t* lastFedAtMs, int32_t hungryAfterSec) {
    constexpr double inf = std::numeric_limits<double>::infinity();
    if (lastFedAtMs == nullptr) return {HungerLevel::Starving, inf, inf};
    // A feeding "from the future" (clock skew) counts as just now, never negative.
    const double ageSec = std::max(0.0, static_cast<double>(nowMs - *lastFedAtMs) / 1000.0);
    if (!(hungryAfterSec > 0)) return {HungerLevel::Starving, inf, ageSec};
    const double ratio = ageSec / hungryAfterSec;
    HungerLevel level;
    if (ageSec < kFedWindowSec) level = HungerLevel::Fed;
    else if (ratio < 0.5) level = HungerLevel::Content;
    else if (ratio < 0.75) level = HungerLevel::Peckish;
    else if (ratio < 1.0) level = HungerLevel::Hungry;
    else if (ratio < 1.5) level = HungerLevel::VeryHungry;
    else level = HungerLevel::Starving;
    return {level, ratio, ageSec};
}

inline const char* levelName(HungerLevel l) {
    switch (l) {
        case HungerLevel::Fed: return "fed";
        case HungerLevel::Content: return "content";
        case HungerLevel::Peckish: return "peckish";
        case HungerLevel::Hungry: return "hungry";
        case HungerLevel::VeryHungry: return "very_hungry";
        case HungerLevel::Starving: return "starving";
    }
    return "starving";
}

inline LevelColor levelColor(HungerLevel l) {
    switch (l) {
        case HungerLevel::Fed: case HungerLevel::Content: return LevelColor::Good;
        case HungerLevel::Peckish: case HungerLevel::Hungry: return LevelColor::Warn;
        case HungerLevel::VeryHungry: case HungerLevel::Starving: return LevelColor::Danger;
    }
    return LevelColor::Danger;
}

}  // namespace feedme2::domain
