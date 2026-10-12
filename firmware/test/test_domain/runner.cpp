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

// test_units.cpp
void test_units_fixture_loads();
void test_units_to_mg_matches_every_vector();
void test_units_step_matches_every_vector();
void test_units_snap_and_format();
void test_units_round_half_away_from_zero();

// test_hunger.cpp
void test_hunger_fixture_every_case();
void test_hunger_colours_and_degenerate_interval();

// test_clock.cpp
void test_clock_unsynced_reports_monotonic_and_flag();
void test_clock_syncs_from_server_and_keeps_counting();

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
    RUN_TEST(test_units_fixture_loads);
    RUN_TEST(test_units_to_mg_matches_every_vector);
    RUN_TEST(test_units_step_matches_every_vector);
    RUN_TEST(test_units_snap_and_format);
    RUN_TEST(test_units_round_half_away_from_zero);
    RUN_TEST(test_hunger_fixture_every_case);
    RUN_TEST(test_hunger_colours_and_degenerate_interval);
    RUN_TEST(test_clock_unsynced_reports_monotonic_and_flag);
    RUN_TEST(test_clock_syncs_from_server_and_keeps_counting);
    return UNITY_END();
}
