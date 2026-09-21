// Single Unity entry point. Each test file declares `void test_*()`
// functions; they are forward-declared and RUN_TEST-ed here. A stale
// entry is a link error. A NEW test that is not added here is silently
// uncalled — when you add a test function, add it below in both places.
#include <unity.h>

// test_version.cpp
void test_version_equal();
void test_version_numeric_ordering_beats_lexicographic();
void test_version_missing_segments_treated_as_zero();
void test_version_prerelease_sorts_before_release();

// test_sim_input.cpp
void test_sim_input_parses_known_commands();
void test_sim_input_is_case_insensitive_and_trims();
void test_sim_input_unknown_is_none();
void test_sim_input_names_round_trip();

extern "C" void setUp(void) {}
extern "C" void tearDown(void) {}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_version_equal);
    RUN_TEST(test_version_numeric_ordering_beats_lexicographic);
    RUN_TEST(test_version_missing_segments_treated_as_zero);
    RUN_TEST(test_version_prerelease_sorts_before_release);
    RUN_TEST(test_sim_input_parses_known_commands);
    RUN_TEST(test_sim_input_is_case_insensitive_and_trims);
    RUN_TEST(test_sim_input_unknown_is_none);
    RUN_TEST(test_sim_input_names_round_trip);
    return UNITY_END();
}
