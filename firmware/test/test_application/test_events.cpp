#include <unity.h>
#include "application/Events.h"

// Every event of the grammar (spec §5.2): the simulator's input lines and the field log print these.
void test_events_have_stable_names() {
    using feedme2::application::InputEvent;
    using feedme2::application::eventName;
    TEST_ASSERT_EQUAL_STRING("None", eventName(InputEvent::None));
    TEST_ASSERT_EQUAL_STRING("RotateCW", eventName(InputEvent::RotateCW));
    TEST_ASSERT_EQUAL_STRING("RotateCCW", eventName(InputEvent::RotateCCW));
    TEST_ASSERT_EQUAL_STRING("Press", eventName(InputEvent::Press));
    TEST_ASSERT_EQUAL_STRING("DoubleTap", eventName(InputEvent::DoubleTap));
    TEST_ASSERT_EQUAL_STRING("LongPress", eventName(InputEvent::LongPress));
    TEST_ASSERT_EQUAL_STRING("SwipeLeft", eventName(InputEvent::SwipeLeft));
    TEST_ASSERT_EQUAL_STRING("SwipeRight", eventName(InputEvent::SwipeRight));
    // A value outside the enum prints "None", never a dangling pointer.
    TEST_ASSERT_EQUAL_STRING("None", eventName(static_cast<InputEvent>(99)));
}
