#include <unity.h>
#include "domain/LongPressArc.h"
using feedme2::domain::LongPressArc;

void test_arc_charges_over_hold_and_resets_on_release() {
    LongPressArc a(600);
    a.update(0, true);   TEST_ASSERT_EQUAL_INT(0, a.percent()); TEST_ASSERT_TRUE(a.charging());
    a.update(300, true); TEST_ASSERT_EQUAL_INT(50, a.percent());
    a.update(900, true); TEST_ASSERT_EQUAL_INT(100, a.percent());
    a.update(950, false); TEST_ASSERT_EQUAL_INT(0, a.percent()); TEST_ASSERT_FALSE(a.charging());
}

// Task 16: a release and a new press start a fresh hold from zero, the percentage never exceeds
// 100 however long the hold, and the hold length is the constructor's, not a fixed 600.
void test_arc_re_press_restarts_from_zero_and_caps_at_hundred() {
    LongPressArc a(1000);
    a.update(5000, true);  TEST_ASSERT_EQUAL_INT(0, a.percent());
    a.update(5250, true);  TEST_ASSERT_EQUAL_INT(25, a.percent());
    a.update(5999, true);  TEST_ASSERT_EQUAL_INT(99, a.percent());
    a.update(6000, true);  TEST_ASSERT_EQUAL_INT(100, a.percent());
    a.update(60'000, true); TEST_ASSERT_EQUAL_INT(100, a.percent());
    a.update(60'001, false);
    TEST_ASSERT_FALSE(a.charging());
    a.update(60'002, true);   // the new hold starts here, not at 5000
    TEST_ASSERT_TRUE(a.charging());
    TEST_ASSERT_EQUAL_INT(0, a.percent());
    a.update(60'502, true);
    TEST_ASSERT_EQUAL_INT(50, a.percent());
    // Not held and never pressed: idle at zero.
    LongPressArc b;
    b.update(100, false);
    TEST_ASSERT_FALSE(b.charging());
    TEST_ASSERT_EQUAL_INT(0, b.percent());
}
