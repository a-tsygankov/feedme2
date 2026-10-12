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
void test_units_can_format_rounds_near_whole_to_whole();
void test_units_can_format_tiny_amount_two_decimals();
void test_units_oz_format_two_decimals_trims_zeros();
void test_units_every_fraction_glyph();
void test_units_snap_step_zero_or_negative_returns_input();
void test_units_parse_labels_round_trip_and_unknown_defaults();

// test_hunger.cpp
void test_hunger_fixture_every_case();
void test_hunger_colours_and_degenerate_interval();
void test_hunger_level_boundaries_within_one_ms();
void test_hunger_level_names_and_colours_for_all_six();

// test_clock.cpp
void test_clock_unsynced_reports_monotonic_and_flag();
void test_clock_syncs_from_server_and_keeps_counting();
void test_clock_survives_the_32bit_monotonic_wrap();

// test_roster.cpp
void test_roster_sorts_and_adds_all_for_two_cats();
void test_roster_single_cat_has_no_all_and_keeps_selection_across_state_updates();
void test_roster_empty_has_nothing_selected_and_rotate_is_safe();
void test_roster_rotate_by_large_negative_wraps();

// test_feedflow.cpp
void test_feedflow_single_cat_steps_in_house_unit_and_confirms_one_draft();
void test_feedflow_cat_without_default_starts_at_fallback_and_never_below_one_step();
void test_feedflow_all_cats_uses_scale_and_each_cats_default();
void test_feedflow_can_unit_formats_fraction_steps();
void test_feedflow_cancel_returns_to_idle_without_drafts();
void test_feedflow_oz_unit_never_overshoots_cap_and_stays_on_grid();
void test_feedflow_begin_snaps_fallback_to_the_unit_grid();
void test_feedflow_gram_cap_is_exact_and_sticky();
void test_feedflow_oz_unit_steps_quarter_ounces_and_formats_two_decimals();
void test_feedflow_all_cats_scale_text_and_amounts_for_all_three();
void test_feedflow_confirm_twice_yields_nothing_and_rotate_is_ignored_outside_amount();

// test_queue.cpp
void test_queue_fifo_head_and_remove_by_id();
void test_queue_drops_oldest_past_cap();
void test_queue_replace_and_head_bounds();

// test_router.cpp
void test_router_stack();
void test_router_screen_name_for_every_id();
void test_router_replace_root_while_deep_collapses_the_stack();

// test_arc.cpp
void test_arc_charges_over_hold_and_resets_on_release();
void test_arc_re_press_restarts_from_zero_and_caps_at_hundred();

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
    RUN_TEST(test_units_can_format_rounds_near_whole_to_whole);
    RUN_TEST(test_units_can_format_tiny_amount_two_decimals);
    RUN_TEST(test_units_oz_format_two_decimals_trims_zeros);
    RUN_TEST(test_units_every_fraction_glyph);
    RUN_TEST(test_units_snap_step_zero_or_negative_returns_input);
    RUN_TEST(test_units_parse_labels_round_trip_and_unknown_defaults);
    RUN_TEST(test_hunger_fixture_every_case);
    RUN_TEST(test_hunger_colours_and_degenerate_interval);
    RUN_TEST(test_hunger_level_boundaries_within_one_ms);
    RUN_TEST(test_hunger_level_names_and_colours_for_all_six);
    RUN_TEST(test_clock_unsynced_reports_monotonic_and_flag);
    RUN_TEST(test_clock_syncs_from_server_and_keeps_counting);
    RUN_TEST(test_clock_survives_the_32bit_monotonic_wrap);
    RUN_TEST(test_roster_sorts_and_adds_all_for_two_cats);
    RUN_TEST(test_roster_single_cat_has_no_all_and_keeps_selection_across_state_updates);
    RUN_TEST(test_roster_empty_has_nothing_selected_and_rotate_is_safe);
    RUN_TEST(test_roster_rotate_by_large_negative_wraps);
    RUN_TEST(test_feedflow_single_cat_steps_in_house_unit_and_confirms_one_draft);
    RUN_TEST(test_feedflow_cat_without_default_starts_at_fallback_and_never_below_one_step);
    RUN_TEST(test_feedflow_all_cats_uses_scale_and_each_cats_default);
    RUN_TEST(test_feedflow_can_unit_formats_fraction_steps);
    RUN_TEST(test_feedflow_cancel_returns_to_idle_without_drafts);
    RUN_TEST(test_feedflow_oz_unit_never_overshoots_cap_and_stays_on_grid);
    RUN_TEST(test_feedflow_begin_snaps_fallback_to_the_unit_grid);
    RUN_TEST(test_feedflow_gram_cap_is_exact_and_sticky);
    RUN_TEST(test_feedflow_oz_unit_steps_quarter_ounces_and_formats_two_decimals);
    RUN_TEST(test_feedflow_all_cats_scale_text_and_amounts_for_all_three);
    RUN_TEST(test_feedflow_confirm_twice_yields_nothing_and_rotate_is_ignored_outside_amount);
    RUN_TEST(test_queue_fifo_head_and_remove_by_id);
    RUN_TEST(test_queue_drops_oldest_past_cap);
    RUN_TEST(test_queue_replace_and_head_bounds);
    RUN_TEST(test_router_stack);
    RUN_TEST(test_router_screen_name_for_every_id);
    RUN_TEST(test_router_replace_root_while_deep_collapses_the_stack);
    RUN_TEST(test_arc_charges_over_hold_and_resets_on_release);
    RUN_TEST(test_arc_re_press_restarts_from_zero_and_caps_at_hundred);
    return UNITY_END();
}
