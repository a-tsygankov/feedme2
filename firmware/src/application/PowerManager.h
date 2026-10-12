#pragma once
#include <cstdint>
#include "application/LogService.h"
#include "ports/IClock.h"
#include "ports/IPower.h"

namespace feedme2::application {

enum class PowerTier : uint8_t { Awake, Dim, LightSleep };

inline const char* tierName(PowerTier t) {
    switch (t) {
        case PowerTier::Awake: return "awake";
        case PowerTier::Dim: return "dim";
        case PowerTier::LightSleep: return "sleep";
    }
    return "awake";
}

// The power tiers of spec §5.5: Awake → Dim 15 s after the last input (backlight 30 %) →
// LightSleep 30 s after it (display sleep-in, backlight and LED off, CPU light sleep bounded by
// the sleep timeout and by the next timer sync). Any input returns the device to Awake, and the
// event that woke it from Dim or LightSleep is reported once through consumeWakeEvent() so the
// UI swallows it: the first turn after a nap wakes the screen and changes nothing (Review Focus 1).
// Deep sleep after `sleep_timeout_sec` is Phase 3, behind the same IPower port.
//
// All times are uint32 monotonic milliseconds compared by subtraction, so they survive the
// 49-day millis() wrap.
class PowerManager {
public:
    static constexpr uint32_t kDimAfterMs = 15'000;
    static constexpr uint32_t kSleepAfterMs = 30'000;
    // A hold longer than this is a stuck input (a touch controller reporting a finger forever),
    // not a person: past it the hold stops resetting the idle timer, so the device still dims
    // and sleeps. A release and a new press start a fresh hold. The longest real hold, the
    // unpair long-press arc, is well under this.
    static constexpr uint32_t kMaxHoldMs = 10'000;
    static constexpr uint8_t kAwakeBacklight = 100;
    static constexpr uint8_t kDimBacklight = 30;
    // A house can set sleep_timeout_sec very low; below this the device would never finish a
    // sync round between naps.
    static constexpr int32_t kMinSleepTimeoutSec = 60;

    PowerManager(ports::IPower& power, ports::IClock& clock, LogService& log);

    // An input event arrived (or the knob/touch went down). Restores Awake; if the device was
    // dim or asleep the event is the wake event and consumeWakeEvent() reports it once.
    void noteInput(uint32_t nowMs);
    // While true the device counts as receiving input continuously (the long-press arc, a finger
    // resting on the glass): it does not dim or sleep for up to kMaxHoldMs, and a press while
    // dim wakes it at once.
    void setHeld(bool held) { held_ = held; }
    // While true light sleep is postponed (a sync round requested or running, a feeding still
    // queued); dimming is not affected. Also stops the next nap while already asleep.
    void holdAwake(bool busy) { busy_ = busy; }
    // Advances the tiers. In LightSleep this calls power.lightSleep() again (it blocks until a
    // GPIO or timer wake on the device) unless busy or a timer wake is waiting to be consumed.
    void tick(uint32_t nowMs);
    PowerTier tier() const { return tier_; }
    // True exactly once after an input (or hold) woke the device from Dim or LightSleep.
    bool consumeWakeEvent();
    // True once per sync interval while asleep: App requests the "timer" sync round on it.
    bool timerWakeDue(uint32_t nowMs);
    // Clamped to kMinSleepTimeoutSec; bounds every lightSleep() call.
    void setSleepTimeoutSec(int32_t sec);
    int32_t sleepTimeoutSec() const { return sleepTimeoutSec_; }
    // Clamped to ≥ 1; the timer wake period while asleep.
    void setSyncIntervalSec(int32_t sec);
    int32_t syncIntervalSec() const { return syncIntervalSec_; }
    bool busy() const { return busy_; }
    bool held() const { return held_; }

private:
    void enter(PowerTier next);
    bool timerDue(uint32_t nowMs) const;
    uint32_t napMs(uint32_t nowMs) const;

    ports::IPower& power_;
    // Unused so far: the plan fixes this ctor shape, and Phase 3 (deep sleep) reads the wake
    // reason through it; tick() takes nowMs so the tests drive time without a clock stub.
    ports::IClock& clock_;
    LogService& log_;
    PowerTier tier_ = PowerTier::Awake;
    uint32_t lastInputMs_ = 0;
    uint32_t holdSinceMs_ = 0;   // first tick of the current hold; valid while holding_
    bool holding_ = false;
    uint32_t nextTimerAtMs_ = 0;
    int32_t sleepTimeoutSec_ = 300;
    int32_t syncIntervalSec_ = 21'600;
    bool held_ = false;
    bool busy_ = false;
    bool wakePending_ = false;
};

}  // namespace feedme2::application
