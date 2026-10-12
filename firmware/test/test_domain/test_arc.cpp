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
