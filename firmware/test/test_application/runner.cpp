#include <unity.h>
void test_events_have_stable_names();
void setUp() {}
void tearDown() {}
int main() {
    UNITY_BEGIN();
    RUN_TEST(test_events_have_stable_names);
    return UNITY_END();
}
