#include <unity.h>
void test_events_have_stable_names();
void test_state_codec_parses_the_sample_fixture();
void test_state_codec_rejects_garbage_and_missing_cats();
void test_heartbeat_encoding();
void test_draft_round_trip_and_array();
void test_accepted_ids_and_server_now();
void test_log_entry_encoding_keeps_data_as_json();
void test_encoded_draft_has_exactly_the_six_contract_keys();
void setUp() {}
void tearDown() {}
int main() {
    UNITY_BEGIN();
    RUN_TEST(test_events_have_stable_names);
    RUN_TEST(test_state_codec_parses_the_sample_fixture);
    RUN_TEST(test_state_codec_rejects_garbage_and_missing_cats);
    RUN_TEST(test_heartbeat_encoding);
    RUN_TEST(test_draft_round_trip_and_array);
    RUN_TEST(test_accepted_ids_and_server_now);
    RUN_TEST(test_log_entry_encoding_keeps_data_as_json);
    RUN_TEST(test_encoded_draft_has_exactly_the_six_contract_keys);
    return UNITY_END();
}
