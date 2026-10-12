#include <unity.h>
#include "domain/Clock.h"

using feedme2::domain::ClockModel;

void test_clock_unsynced_reports_monotonic_and_flag() {
    ClockModel c;
    c.setMonotonic(5000);
    TEST_ASSERT_FALSE(c.isSynced());
    TEST_ASSERT_EQUAL_INT64(5000, c.nowMs());
}

void test_clock_syncs_from_server_and_keeps_counting() {
    ClockModel c;
    c.setMonotonic(5000);
    c.syncFromServer(1'700'000'000'000LL, 5000);
    TEST_ASSERT_TRUE(c.isSynced());
    c.setMonotonic(8000);
    TEST_ASSERT_EQUAL_INT64(1'700'000'003'000LL, c.nowMs());
    // a second sync corrects drift without going backwards in a jump larger than the drift
    c.syncFromServer(1'700'000'004'000LL, 8000);
    TEST_ASSERT_EQUAL_INT64(1'700'000'004'000LL, c.nowMs());
}

void test_clock_survives_the_32bit_monotonic_wrap() {
    // Review (Tasks 2-4): millis() wraps at 49.7 days; nowMs() must keep counting forward across it.
    ClockModel c;
    c.setMonotonic(0xFFFFFF00u);
    TEST_ASSERT_EQUAL_INT64(0xFFFFFF00LL, c.nowMs());
    c.setMonotonic(0x100u);
    TEST_ASSERT_EQUAL_INT64(0xFFFFFF00LL + 0x200LL, c.nowMs());
    // Synced: the offset is taken against the unwrapped counter, so the wall clock advances by the same 0x200.
    c.syncFromServer(1'700'000'000'000LL, 0x100u);
    c.setMonotonic(0x300u);
    TEST_ASSERT_EQUAL_INT64(1'700'000'000'000LL + 0x200LL, c.nowMs());
}
