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
    TEST_ASSERT_EQUAL_STRING("json: ", err.substr(0, 6).c_str());
    TEST_ASSERT_TRUE(err.size() > 6);   // the parser's own message follows the prefix
    TEST_ASSERT_FALSE(application::decodeState("{\"house\":{}}", s, err));
    TEST_ASSERT_EQUAL_STRING("missing house.settings", err.c_str());
    TEST_ASSERT_FALSE(application::decodeState("[]", s, err));
    TEST_ASSERT_EQUAL_STRING("missing house", err.c_str());
    TEST_ASSERT_FALSE(application::decodeState("{\"house\":{\"settings\":{}},\"cats\":\"nope\",\"now\":1}", s, err));
    TEST_ASSERT_EQUAL_STRING("missing cats", err.c_str());
    TEST_ASSERT_FALSE(application::decodeState("{\"house\":{\"settings\":{}},\"cats\":[]}", s, err));
    TEST_ASSERT_EQUAL_STRING("missing now", err.c_str());
    TEST_ASSERT_FALSE(application::decodeState("{\"house\":{\"settings\":{}},\"cats\":[],\"now\":\"soon\"}", s, err));
    TEST_ASSERT_EQUAL_STRING("missing now", err.c_str());
}

// Task 16: the colour is "#rrggbb" in either case; anything else keeps the default green rather
// than painting a cat black or reading past the string.
void test_state_codec_colour_accepts_lowercase_hex_and_falls_back_on_garbage() {
    domain::DeviceState s; std::string err;
    const char* json = "{\"house\":{\"settings\":{}},\"now\":1,\"cats\":["
                       "{\"id\":\"a\",\"color\":\"#ff8800\"},{\"id\":\"b\",\"color\":\"ff8800\"},{\"id\":\"c\",\"color\":\"#ff88\"},"
                       "{\"id\":\"d\",\"color\":\"#gg0000\"},{\"id\":\"e\"},{\"id\":\"f\",\"color\":\"#ABCDEF\"},{\"id\":\"g\",\"color\":\"#0000001\"}]}";
    TEST_ASSERT_TRUE_MESSAGE(application::decodeState(json, s, err), err.c_str());
    TEST_ASSERT_EQUAL_UINT32(7, s.cats.size());
    TEST_ASSERT_EQUAL_HEX32(0xFF8800, s.cats[0].colorRgb);
    TEST_ASSERT_EQUAL_HEX32(0x4CAF50, s.cats[1].colorRgb);   // no '#'
    TEST_ASSERT_EQUAL_HEX32(0x4CAF50, s.cats[2].colorRgb);   // too short
    TEST_ASSERT_EQUAL_HEX32(0x4CAF50, s.cats[3].colorRgb);   // not hex
    TEST_ASSERT_EQUAL_HEX32(0x4CAF50, s.cats[4].colorRgb);   // absent
    TEST_ASSERT_EQUAL_HEX32(0xABCDEF, s.cats[5].colorRgb);   // upper case
    TEST_ASSERT_EQUAL_HEX32(0x4CAF50, s.cats[6].colorRgb);   // too long
}

void test_state_codec_missing_optional_fields_take_defaults() {
    domain::DeviceState s; std::string err;
    const char* json = "{\"house\":{\"settings\":{\"hungryAfterSecDefault\":7200}},\"cats\":[{\"id\":\"x\"}],\"now\":5,\"future\":{\"k\":1}}";
    TEST_ASSERT_TRUE_MESSAGE(application::decodeState(json, s, err), err.c_str());
    TEST_ASSERT_EQUAL_STRING("", err.c_str());
    TEST_ASSERT_EQUAL_STRING("", s.houseId.c_str());
    TEST_ASSERT_EQUAL_STRING("", s.houseName.c_str());
    TEST_ASSERT_EQUAL_INT(0, s.tzOffsetMin);
    TEST_ASSERT_EQUAL(domain::FoodUnit::Grams, s.settings.foodUnit);
    TEST_ASSERT_EQUAL_INT32(domain::kDefaultCanMg, s.settings.canSizeMg);
    TEST_ASSERT_EQUAL(domain::CanFraction::Quarter, s.settings.canFractionStep);
    TEST_ASSERT_EQUAL_INT(5, s.settings.gramStep);
    TEST_ASSERT_EQUAL_INT(25, s.settings.ozStepHundredths);
    TEST_ASSERT_EQUAL_INT32(7200, s.settings.hungryAfterSecDefault);
    TEST_ASSERT_EQUAL_INT32(300, s.settings.sleepTimeoutSec);
    TEST_ASSERT_EQUAL_INT32(21600, s.settings.syncIntervalSec);
    TEST_ASSERT_EQUAL_STRING("UTC", s.settings.timezone.c_str());
    TEST_ASSERT_EQUAL_STRING("", s.deviceId.c_str());
    TEST_ASSERT_EQUAL_STRING("", s.deviceName.c_str());
    TEST_ASSERT_EQUAL_INT64(5, s.nowMs);
    TEST_ASSERT_EQUAL_UINT32(1, s.cats.size());
    const auto& c = s.cats[0];
    TEST_ASSERT_EQUAL_STRING("x", c.id.c_str());
    TEST_ASSERT_EQUAL_STRING("", c.name.c_str());
    TEST_ASSERT_EQUAL_HEX32(0x4CAF50, c.colorRgb);
    TEST_ASSERT_EQUAL_STRING("C2", c.avatarPose.c_str());
    TEST_ASSERT_EQUAL_INT32(7200, c.hungryAfterSec);   // the house default, not the compiled-in 18000
    TEST_ASSERT_EQUAL_INT(0, c.sortOrder);
    TEST_ASSERT_FALSE(c.hasDefault);
    TEST_ASSERT_EQUAL_INT32(0, c.defaultAmountMg);
    TEST_ASSERT_FALSE(c.hasLastFed);
}

// shared/src/device.ts bounds tzOffsetMin to [-900, 900]; the codec passes the extremes through
// unchanged and signed, since the About screen prints the local time from it.
void test_state_codec_tz_offset_extremes_pass_through_signed() {
    domain::DeviceState s; std::string err;
    TEST_ASSERT_TRUE(application::decodeState("{\"house\":{\"tzOffsetMin\":-900,\"settings\":{}},\"cats\":[],\"now\":1}", s, err));
    TEST_ASSERT_EQUAL_INT(-900, s.tzOffsetMin);
    TEST_ASSERT_TRUE(application::decodeState("{\"house\":{\"tzOffsetMin\":900,\"settings\":{}},\"cats\":[],\"now\":1}", s, err));
    TEST_ASSERT_EQUAL_INT(900, s.tzOffsetMin);
    TEST_ASSERT_TRUE(application::decodeState("{\"house\":{\"tzOffsetMin\":0,\"settings\":{}},\"cats\":[],\"now\":1}", s, err));
    TEST_ASSERT_EQUAL_INT(0, s.tzOffsetMin);
    TEST_ASSERT_TRUE(application::decodeState("{\"house\":{\"tzOffsetMin\":-30,\"settings\":{}},\"cats\":[],\"now\":1}", s, err));
    TEST_ASSERT_EQUAL_INT(-30, s.tzOffsetMin);
}

// A zero interval would divide by zero in Hunger or spin the sync timer: each one is named.
void test_state_codec_rejects_non_positive_intervals_naming_the_field() {
    domain::DeviceState s; std::string err;
    // A good decode first, so a failure below can be shown to leave `out` untouched.
    TEST_ASSERT_TRUE(application::decodeState(readFixture("device-state.sample.json"), s, err));
    auto rejects = [&](const char* json, const char* want) {
        TEST_ASSERT_FALSE_MESSAGE(application::decodeState(json, s, err), json);
        TEST_ASSERT_EQUAL_STRING_MESSAGE(want, err.c_str(), json);
    };
    rejects("{\"house\":{\"settings\":{\"canSizeMg\":0}},\"cats\":[],\"now\":1}", "invalid house.settings.canSizeMg");
    rejects("{\"house\":{\"settings\":{\"gramStep\":-1}},\"cats\":[],\"now\":1}", "invalid house.settings.gramStep");
    rejects("{\"house\":{\"settings\":{\"ozStepHundredths\":0}},\"cats\":[],\"now\":1}", "invalid house.settings.ozStepHundredths");
    rejects("{\"house\":{\"settings\":{\"hungryAfterSecDefault\":0}},\"cats\":[],\"now\":1}", "invalid house.settings.hungryAfterSecDefault");
    rejects("{\"house\":{\"settings\":{\"syncIntervalSec\":0}},\"cats\":[],\"now\":1}", "invalid syncIntervalSec");
    // The top-level pair overrides the settings: a bad top-level value fails even with good settings.
    rejects("{\"house\":{\"settings\":{\"sleepTimeoutSec\":300}},\"cats\":[],\"now\":1,\"sleepTimeoutSec\":0}", "invalid sleepTimeoutSec");
    rejects("{\"house\":{\"settings\":{}},\"cats\":[{\"id\":\"a\",\"hungryAfterSec\":0}],\"now\":1}", "invalid cats[].hungryAfterSec");
    rejects("{\"house\":{\"settings\":{}},\"cats\":[{\"name\":\"Nameless\"}],\"now\":1}", "missing cats[].id");
    rejects("{\"house\":{\"settings\":{}},\"cats\":[{\"id\":\"\"}],\"now\":1}", "missing cats[].id");
    TEST_ASSERT_EQUAL_UINT32(2, s.cats.size());
    TEST_ASSERT_EQUAL_STRING("Mochi House", s.houseName.c_str());
}

void test_state_codec_top_level_intervals_override_settings_and_cats_sort() {
    domain::DeviceState s; std::string err;
    const char* json = "{\"house\":{\"settings\":{\"sleepTimeoutSec\":300,\"syncIntervalSec\":21600}},"
                       "\"cats\":[{\"id\":\"b\",\"sortOrder\":1,\"extra\":true},{\"id\":\"a\",\"sortOrder\":2},{\"id\":\"c\",\"sortOrder\":1}],"
                       "\"now\":1,\"sleepTimeoutSec\":120,\"syncIntervalSec\":900}";
    TEST_ASSERT_TRUE_MESSAGE(application::decodeState(json, s, err), err.c_str());
    TEST_ASSERT_EQUAL_INT32(120, s.settings.sleepTimeoutSec);
    TEST_ASSERT_EQUAL_INT32(900, s.settings.syncIntervalSec);
    // sortOrder first, id breaks the tie: b, c, a.
    TEST_ASSERT_EQUAL_UINT32(3, s.cats.size());
    TEST_ASSERT_EQUAL_STRING("b", s.cats[0].id.c_str());
    TEST_ASSERT_EQUAL_STRING("c", s.cats[1].id.c_str());
    TEST_ASSERT_EQUAL_STRING("a", s.cats[2].id.c_str());
    // Without the top-level pair the settings stand.
    TEST_ASSERT_TRUE(application::decodeState("{\"house\":{\"settings\":{\"sleepTimeoutSec\":90,\"syncIntervalSec\":600}},\"cats\":[],\"now\":1}", s, err));
    TEST_ASSERT_EQUAL_INT32(90, s.settings.sleepTimeoutSec);
    TEST_ASSERT_EQUAL_INT32(600, s.settings.syncIntervalSec);
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
