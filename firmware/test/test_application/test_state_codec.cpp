#include <unity.h>
#include "application/StateCodec.h"
#include "fixtures.h"
using namespace feedme2;

void test_state_codec_parses_the_sample_fixture() {
    domain::DeviceState s; std::string err;
    TEST_ASSERT_TRUE_MESSAGE(application::decodeState(readFixture("device-state.sample.json"), s, err), err.c_str());
    TEST_ASSERT_EQUAL_STRING("Mochi House", s.houseName.c_str());
    TEST_ASSERT_EQUAL_INT(-240, s.tzOffsetMin);
    TEST_ASSERT_EQUAL(domain::FoodUnit::Grams, s.settings.foodUnit);
    TEST_ASSERT_EQUAL_INT32(155922, s.settings.canSizeMg);
    TEST_ASSERT_EQUAL(domain::CanFraction::Quarter, s.settings.canFractionStep);
    TEST_ASSERT_EQUAL_INT32(300, s.settings.sleepTimeoutSec);
    TEST_ASSERT_EQUAL_STRING("Kitchen", s.deviceName.c_str());
    TEST_ASSERT_EQUAL_UINT32(2, s.cats.size());
    TEST_ASSERT_EQUAL_STRING("Mochi", s.cats[0].name.c_str());
    TEST_ASSERT_EQUAL_HEX32(0x4CAF50, s.cats[0].colorRgb);
    TEST_ASSERT_TRUE(s.cats[0].hasDefault); TEST_ASSERT_EQUAL_INT32(40000, s.cats[0].defaultAmountMg);
    TEST_ASSERT_TRUE(s.cats[0].hasLastFed); TEST_ASSERT_EQUAL_INT64(1700000000000LL, s.cats[0].lastFedAtMs);
    TEST_ASSERT_FALSE(s.cats[1].hasDefault); TEST_ASSERT_FALSE(s.cats[1].hasLastFed);
    TEST_ASSERT_EQUAL_INT64(1700003600000LL, s.nowMs);
}

void test_state_codec_rejects_garbage_and_missing_cats() {
    domain::DeviceState s; std::string err;
    TEST_ASSERT_FALSE(application::decodeState("{not json", s, err));
    TEST_ASSERT_FALSE(application::decodeState("{\"house\":{}}", s, err));
    TEST_ASSERT_TRUE(err.size() > 0);
}

void test_heartbeat_encoding() {
    const auto j = application::encodeHeartbeat("0.2.0", 120, "POWERON", 150000, -1);
    JsonDocument d; TEST_ASSERT_FALSE(deserializeJson(d, j));
    TEST_ASSERT_EQUAL_STRING("0.2.0", d["fwVersion"]);
    TEST_ASSERT_EQUAL_UINT32(120, d["uptimeSec"].as<uint32_t>());
    TEST_ASSERT_FALSE(d["batteryPct"].is<int>());
    TEST_ASSERT_TRUE(deserializeJson(d, application::encodeHeartbeat("0.2.0", 1, "SW", 1, 87)) == DeserializationError::Ok);
    TEST_ASSERT_EQUAL_INT(87, d["batteryPct"].as<int>());
}
