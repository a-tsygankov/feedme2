#include <unity.h>
#include "application/Events.h"

void test_events_have_stable_names() {
    using feedme2::application::InputEvent;
    TEST_ASSERT_EQUAL_STRING("Press", feedme2::application::eventName(InputEvent::Press));
    TEST_ASSERT_EQUAL_STRING("RotateCW", feedme2::application::eventName(InputEvent::RotateCW));
    TEST_ASSERT_EQUAL_STRING("None", feedme2::application::eventName(InputEvent::None));
}
