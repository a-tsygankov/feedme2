#include <algorithm>
#include <unity.h>
#include "application/QueueCodec.h"
using namespace feedme2;

static bool decodeDraftFails(const std::string& s) { domain::FeedingDraft d; return !application::decodeDraft(s, d); }

void test_draft_round_trip_and_array() {
    domain::FeedingDraft d; d.id = "4b1a0e2d-7c7b-4b7e-9a3a-5c3e2e1f0a11"; d.catId = "cat"; d.fedAtMs = 1700000000000LL; d.amountMg = 51974; d.unit = domain::FoodUnit::Cans; d.enteredValue = "1/3";
    const auto line = application::encodeDraft(d);
    TEST_ASSERT_EQUAL(std::string::npos, line.find('\n'));
    domain::FeedingDraft back;
    TEST_ASSERT_TRUE(application::decodeDraft(line, back));
    TEST_ASSERT_EQUAL_STRING("1/3", back.enteredValue.c_str());
    TEST_ASSERT_EQUAL(domain::FoodUnit::Cans, back.unit);
    TEST_ASSERT_EQUAL_INT64(1700000000000LL, back.fedAtMs);
    const auto arr = application::encodeDraftsArray({d, d});
    TEST_ASSERT_EQUAL_CHAR('[', arr.front()); TEST_ASSERT_EQUAL_CHAR(']', arr.back());
    JsonDocument doc; TEST_ASSERT_FALSE(deserializeJson(doc, arr));
    TEST_ASSERT_EQUAL_UINT32(2, doc.as<JsonArray>().size());
    TEST_ASSERT_EQUAL_STRING("can", doc[0]["enteredUnit"]);
    TEST_ASSERT_TRUE(decodeDraftFails("{\"id\":1}"));
}

void test_accepted_ids_and_server_now() {
    int64_t now = 0;
    const auto ids = application::decodeAcceptedIds("{\"accepted\":[\"a\",\"b\"],\"clamped\":[\"b\"],\"now\":1700000000123}", &now);
    TEST_ASSERT_EQUAL_UINT32(2, ids.size());
    TEST_ASSERT_EQUAL_STRING("b", ids[1].c_str());
    TEST_ASSERT_EQUAL_INT64(1700000000123LL, now);
    TEST_ASSERT_EQUAL_UINT32(0, application::decodeAcceptedIds("nope", nullptr).size());
}

void test_log_entry_encoding_keeps_data_as_json() {
    const auto l = application::encodeLogEntry(1700000000000LL, "info", "idle cat=Mochi level=content", "{\"rssi\":-60}");
    JsonDocument d; TEST_ASSERT_FALSE(deserializeJson(d, l));
    TEST_ASSERT_EQUAL_STRING("info", d["level"]);
    TEST_ASSERT_EQUAL_INT(-60, d["data"]["rssi"].as<int>());
    const auto none = application::encodeLogEntry(1, "warn", "x", nullptr);
    TEST_ASSERT_FALSE(deserializeJson(d, none)); TEST_ASSERT_FALSE(d["data"].is<JsonObject>());
    TEST_ASSERT_EQUAL_STRING("[{\"a\":1},{\"b\":2}]", application::joinArray({"{\"a\":1}", "{\"b\":2}"}).c_str());
}

// DeviceFeedingCreateSchema is strict: an unknown key is a 400 that drops the whole batch as Permanent.
void test_encoded_draft_has_exactly_the_six_contract_keys() {
    domain::FeedingDraft d; d.id = "4b1a0e2d-7c7b-4b7e-9a3a-5c3e2e1f0a11"; d.catId = "cat"; d.fedAtMs = 0; d.amountMg = 40000; d.unit = domain::FoodUnit::Grams; d.enteredValue = "40";
    JsonDocument doc; TEST_ASSERT_FALSE(deserializeJson(doc, application::encodeDraft(d)));
    std::vector<std::string> keys; for (JsonPair kv : doc.as<JsonObject>()) keys.push_back(kv.key().c_str());
    std::sort(keys.begin(), keys.end());
    const std::vector<std::string> want = {"amountMg", "catId", "enteredUnit", "enteredValue", "fedAt", "id"};
    TEST_ASSERT_TRUE(keys == want);
    TEST_ASSERT_EQUAL_INT64(0, doc["fedAt"].as<int64_t>());   // 0 before the first clock sync is legal: the server clamps it to now
}
