#include "application/PowerManager.h"
#include <algorithm>
#include <string>

namespace feedme2::application {

PowerManager::PowerManager(ports::IPower& power, ports::IClock& clock, LogService& log)
    : power_(power), clock_(clock), log_(log) {}

void PowerManager::setSleepTimeoutSec(int32_t sec) { sleepTimeoutSec_ = std::max(sec, kMinSleepTimeoutSec); }

void PowerManager::setSyncIntervalSec(int32_t sec) { syncIntervalSec_ = std::max<int32_t>(sec, 1); }

void PowerManager::enter(PowerTier next) {
    if (next == tier_) return;
    const PowerTier prev = tier_;
    tier_ = next;
    switch (next) {
        case PowerTier::Awake:
            // Sleep-out first: EspPower waits 120 ms for SLPOUT, and a backlight already on
            // would show that as a blank flash before the retained frame reappears.
            if (prev == PowerTier::LightSleep) power_.displaySleep(false);
            power_.setBacklight(kAwakeBacklight);
            // The event that brought us here must not reach the screens: a person turning the
            // knob at a dark screen expects it to light up, not the cat to change.
            wakePending_ = true;
            break;
        case PowerTier::Dim:
            power_.setBacklight(kDimBacklight);
            break;
        case PowerTier::LightSleep:
            power_.setBacklight(0);
            power_.ledRing(0, 0);
            power_.displaySleep(true);
            break;
    }
    log_.event("power", (std::string("tier=") + tierName(next)).c_str());
}

void PowerManager::noteInput(uint32_t nowMs) {
    lastInputMs_ = nowMs;
    enter(PowerTier::Awake);
}

bool PowerManager::consumeWakeEvent() {
    const bool pending = wakePending_;
    wakePending_ = false;
    return pending;
}

bool PowerManager::timerDue(uint32_t nowMs) const {
    return tier_ == PowerTier::LightSleep && static_cast<int32_t>(nowMs - nextTimerAtMs_) >= 0;
}

bool PowerManager::timerWakeDue(uint32_t nowMs) {
    if (!timerDue(nowMs)) return false;
    // Anchor the next wake on this one, not on `nowMs`, so a late poll does not drift the period.
    nextTimerAtMs_ += static_cast<uint32_t>(syncIntervalSec_) * 1000u;
    if (static_cast<int32_t>(nowMs - nextTimerAtMs_) >= 0) nextTimerAtMs_ = nowMs + static_cast<uint32_t>(syncIntervalSec_) * 1000u;
    return true;
}

uint32_t PowerManager::napMs(uint32_t nowMs) const {
    const uint32_t cap = static_cast<uint32_t>(sleepTimeoutSec_) * 1000u;
    const uint32_t untilTimer = nextTimerAtMs_ - nowMs;
    return std::min(cap, untilTimer);
}

void PowerManager::tick(uint32_t nowMs) {
    if (held_) {
        if (!holding_) { holding_ = true; holdSinceMs_ = nowMs; }
        if (nowMs - holdSinceMs_ <= kMaxHoldMs) {
            noteInput(nowMs);
            return;
        }
        // A stuck hold: fall through and let the idle timers run from the last counted tick.
    } else {
        holding_ = false;
    }
    const uint32_t idle = nowMs - lastInputMs_;
    if (tier_ == PowerTier::Awake && idle >= kDimAfterMs) enter(PowerTier::Dim);
    if (tier_ == PowerTier::Dim && idle >= kSleepAfterMs && !busy_) {
        nextTimerAtMs_ = nowMs + static_cast<uint32_t>(syncIntervalSec_) * 1000u;
        enter(PowerTier::LightSleep);
        power_.lightSleep(napMs(nowMs));
        return;
    }
    if (tier_ == PowerTier::LightSleep) {
        // A due timer wake waits for App to request its sync round; a busy device (that round
        // running) stays up with the screen off; otherwise nap until the next wake.
        if (busy_ || timerDue(nowMs)) return;
        power_.lightSleep(napMs(nowMs));
    }
}

}  // namespace feedme2::application
