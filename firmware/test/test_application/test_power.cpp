#include <unity.h>
#include <cstdint>
#include "application/LogService.h"
#include "application/PowerManager.h"
#include "stubs.h"
using namespace feedme2;
using application::PowerTier;

namespace {
// StubPower only counts lightSleep calls; the max-ms argument is what bounds the timer wake,
// so this rig records it too.
struct CapturingPower : test::StubPower {
    uint32_t lastMaxMs = 0;
    void lightSleep(uint32_t maxMs) override { lastMaxMs = maxMs; ++lightSleeps; }
};
struct Rig {
    CapturingPower power; test::StubClock clk; test::StubLogSink serial; test::StubFileQueue files;
    domain::ClockModel model;
    application::LogService log{serial, files, clk, model};
    application::PowerManager pm{power, clk, log};
    bool serialHas(const char* needle) const {
        for (const auto& l : serial.lines) if (l.find(needle) != std::string::npos) return true;
        return false;
    }
};
}  // namespace

void test_power_awake_dims_then_sleeps_and_input_wakes() {
    Rig r;
    r.pm.tick(0);
    TEST_ASSERT_EQUAL(PowerTier::Awake, r.pm.tier());
    TEST_ASSERT_EQUAL_INT(100, r.power.backlight);
    r.pm.tick(14'999);
    TEST_ASSERT_EQUAL(PowerTier::Awake, r.pm.tier());
    r.pm.tick(15'001);
    TEST_ASSERT_EQUAL(PowerTier::Dim, r.pm.tier());
    TEST_ASSERT_EQUAL_INT(30, r.power.backlight);
    TEST_ASSERT_FALSE(r.power.displayAsleep);
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] power tier=dim"));
    r.pm.tick(29'999);
    TEST_ASSERT_EQUAL(PowerTier::Dim, r.pm.tier());
    r.power.lastRgb = 0xFF0000;
    r.pm.tick(30'001);
    TEST_ASSERT_EQUAL(PowerTier::LightSleep, r.pm.tier());
    TEST_ASSERT_TRUE(r.power.displayAsleep);
    TEST_ASSERT_EQUAL_INT(0, r.power.backlight);
    TEST_ASSERT_EQUAL_UINT32(0, r.power.lastRgb);
    TEST_ASSERT_EQUAL_INT(1, r.power.lightSleeps);
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] power tier=sleep"));
    // Nothing woke us (the stub returns at once): the screen stays off until an input arrives.
    TEST_ASSERT_FALSE(r.pm.consumeWakeEvent());
    r.pm.noteInput(31'000);
    TEST_ASSERT_EQUAL(PowerTier::Awake, r.pm.tier());
    TEST_ASSERT_EQUAL_INT(100, r.power.backlight);
    TEST_ASSERT_FALSE(r.power.displayAsleep);
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] power tier=awake"));
    TEST_ASSERT_TRUE(r.pm.consumeWakeEvent());
    TEST_ASSERT_FALSE(r.pm.consumeWakeEvent());
    // The wake restarted the idle timers: no dim until 15 s after the input.
    r.pm.tick(45'000);
    TEST_ASSERT_EQUAL(PowerTier::Awake, r.pm.tier());
    r.pm.tick(46'001);
    TEST_ASSERT_EQUAL(PowerTier::Dim, r.pm.tier());
}

void test_power_input_while_dim_is_swallowed_once() {
    Rig r;
    r.pm.tick(0);
    r.pm.tick(16'000);
    TEST_ASSERT_EQUAL(PowerTier::Dim, r.pm.tier());
    r.pm.noteInput(16'100);
    TEST_ASSERT_EQUAL(PowerTier::Awake, r.pm.tier());
    TEST_ASSERT_EQUAL_INT(100, r.power.backlight);
    TEST_ASSERT_TRUE(r.pm.consumeWakeEvent());
    TEST_ASSERT_FALSE(r.pm.consumeWakeEvent());
    // Input while already awake is a real event, never swallowed.
    r.pm.noteInput(16'200);
    TEST_ASSERT_FALSE(r.pm.consumeWakeEvent());
    TEST_ASSERT_EQUAL_INT(0, r.power.lightSleeps);
}

void test_power_timer_wake_due_once_per_interval() {
    Rig r;
    r.pm.setSyncIntervalSec(60);
    r.pm.tick(0);
    // Not sleeping: the sync service's own timer owns the interval while awake.
    TEST_ASSERT_FALSE(r.pm.timerWakeDue(70'000));
    r.pm.tick(31'000);
    TEST_ASSERT_EQUAL(PowerTier::LightSleep, r.pm.tier());
    TEST_ASSERT_FALSE(r.pm.timerWakeDue(90'000));
    TEST_ASSERT_TRUE(r.pm.timerWakeDue(31'000 + 60'000));
    TEST_ASSERT_FALSE(r.pm.timerWakeDue(91'001));
    TEST_ASSERT_FALSE(r.pm.timerWakeDue(150'999));
    TEST_ASSERT_TRUE(r.pm.timerWakeDue(151'000));
    TEST_ASSERT_FALSE(r.pm.timerWakeDue(151'001));
    // A timer wake leaves the screen off: the tier is still LightSleep and no event is swallowed.
    TEST_ASSERT_EQUAL(PowerTier::LightSleep, r.pm.tier());
    TEST_ASSERT_TRUE(r.power.displayAsleep);
    TEST_ASSERT_FALSE(r.pm.consumeWakeEvent());
}

void test_power_sleep_timeout_from_settings_bounds_light_sleep_call() {
    Rig r;
    r.pm.setSleepTimeoutSec(600);
    r.pm.setSyncIntervalSec(21'600);
    r.pm.tick(0);
    r.pm.tick(31'000);
    TEST_ASSERT_EQUAL_INT(1, r.power.lightSleeps);
    TEST_ASSERT_TRUE(r.power.lastMaxMs > 0);
    TEST_ASSERT_TRUE(r.power.lastMaxMs <= 600'000u);
    // A sync due sooner than the timeout bounds the nap so the timer wake lands on the round.
    Rig s;
    s.pm.setSleepTimeoutSec(600);
    s.pm.setSyncIntervalSec(60);
    s.pm.tick(0);
    s.pm.tick(31'000);
    TEST_ASSERT_EQUAL_UINT32(60'000, s.power.lastMaxMs);
    // Each further sleeping tick naps again, for the time left to the next sync.
    s.pm.tick(41'000);
    TEST_ASSERT_EQUAL_INT(2, s.power.lightSleeps);
    TEST_ASSERT_EQUAL_UINT32(50'000, s.power.lastMaxMs);
    // Once the timer wake is due the tick does not nap again until App has consumed it.
    s.pm.tick(91'000);
    TEST_ASSERT_EQUAL_INT(2, s.power.lightSleeps);
    TEST_ASSERT_TRUE(s.pm.timerWakeDue(91'000));
    s.pm.tick(91'001);
    TEST_ASSERT_EQUAL_INT(3, s.power.lightSleeps);
    TEST_ASSERT_EQUAL_UINT32(59'999, s.power.lastMaxMs);
}

void test_power_sleep_timeout_below_sixty_seconds_clamps_to_sixty() {
    Rig r;
    r.pm.setSleepTimeoutSec(10);
    TEST_ASSERT_EQUAL_INT32(60, r.pm.sleepTimeoutSec());
    r.pm.setSyncIntervalSec(21'600);
    r.pm.tick(0);
    r.pm.tick(31'000);
    TEST_ASSERT_EQUAL_UINT32(60'000, r.power.lastMaxMs);
    r.pm.setSleepTimeoutSec(0);
    TEST_ASSERT_EQUAL_INT32(60, r.pm.sleepTimeoutSec());
    r.pm.setSleepTimeoutSec(-5);
    TEST_ASSERT_EQUAL_INT32(60, r.pm.sleepTimeoutSec());
    r.pm.setSleepTimeoutSec(300);
    TEST_ASSERT_EQUAL_INT32(300, r.pm.sleepTimeoutSec());
}

void test_power_held_knob_never_sleeps_and_its_wake_is_swallowed() {
    Rig r;
    r.pm.tick(0);
    r.pm.setHeld(true);
    r.pm.tick(20'000);
    r.pm.tick(100'000);
    TEST_ASSERT_EQUAL(PowerTier::Awake, r.pm.tier());
    TEST_ASSERT_EQUAL_INT(100, r.power.backlight);
    TEST_ASSERT_EQUAL_INT(0, r.power.lightSleeps);
    TEST_ASSERT_FALSE(r.pm.consumeWakeEvent());
    // Release: the idle timers run from the release, not from the press.
    r.pm.setHeld(false);
    r.pm.tick(114'999);
    TEST_ASSERT_EQUAL(PowerTier::Awake, r.pm.tier());
    r.pm.tick(115'001);
    TEST_ASSERT_EQUAL(PowerTier::Dim, r.pm.tier());
    // Pressing down while dim wakes the screen at once; the Press/LongPress that follows is swallowed.
    r.pm.setHeld(true);
    r.pm.tick(116'000);
    TEST_ASSERT_EQUAL(PowerTier::Awake, r.pm.tier());
    TEST_ASSERT_TRUE(r.pm.consumeWakeEvent());
    TEST_ASSERT_FALSE(r.pm.consumeWakeEvent());
}

void test_power_hold_awake_postpones_light_sleep_but_not_dim() {
    Rig r;
    r.pm.tick(0);
    r.pm.holdAwake(true);
    r.pm.tick(16'000);
    TEST_ASSERT_EQUAL(PowerTier::Dim, r.pm.tier());
    r.pm.tick(60'000);
    TEST_ASSERT_EQUAL(PowerTier::Dim, r.pm.tier());
    TEST_ASSERT_EQUAL_INT(0, r.power.lightSleeps);
    TEST_ASSERT_FALSE(r.power.displayAsleep);
    r.pm.holdAwake(false);
    r.pm.tick(60'001);
    TEST_ASSERT_EQUAL(PowerTier::LightSleep, r.pm.tier());
    TEST_ASSERT_EQUAL_INT(1, r.power.lightSleeps);
    // Busy while already asleep (a timer round running) stops the next nap until it is done.
    r.pm.holdAwake(true);
    r.pm.tick(60'002);
    TEST_ASSERT_EQUAL_INT(1, r.power.lightSleeps);
    TEST_ASSERT_EQUAL(PowerTier::LightSleep, r.pm.tier());
    r.pm.holdAwake(false);
    r.pm.tick(60'003);
    TEST_ASSERT_EQUAL_INT(2, r.power.lightSleeps);
}

void test_power_timers_survive_millis_wrap() {
    Rig r;
    r.pm.setSyncIntervalSec(60);
    const uint32_t start = UINT32_MAX - 20'000;
    r.pm.noteInput(start);
    r.pm.tick(start + 14'999);
    TEST_ASSERT_EQUAL(PowerTier::Awake, r.pm.tier());
    r.pm.tick(start + 15'001);   // past UINT32_MAX
    TEST_ASSERT_EQUAL(PowerTier::Dim, r.pm.tier());
    r.pm.tick(start + 30'001);
    TEST_ASSERT_EQUAL(PowerTier::LightSleep, r.pm.tier());
    TEST_ASSERT_FALSE(r.pm.timerWakeDue(start + 30'001 + 59'999));
    TEST_ASSERT_TRUE(r.pm.timerWakeDue(start + 30'001 + 60'000));
}
