// Single Unity entry point. Each test file declares `void test_*()`
// functions; they are forward-declared here so a missing test is a
// link error rather than a silently uncalled function.
#include <unity.h>

// test_version.cpp
void test_version_equal();
void test_version_numeric_ordering_beats_lexicographic();
void test_version_missing_segments_treated_as_zero();
void test_version_prerelease_sorts_before_release();

extern "C" void setUp(void) {}
extern "C" void tearDown(void) {}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_version_equal);
    RUN_TEST(test_version_numeric_ordering_beats_lexicographic);
    RUN_TEST(test_version_missing_segments_treated_as_zero);
    RUN_TEST(test_version_prerelease_sorts_before_release);
    return UNITY_END();
}
