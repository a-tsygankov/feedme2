#include <unity.h>
#include "domain/Hunger.h"
#include "fixtures.h"

using namespace feedme2::domain;

void test_hunger_fixture_every_case() {
    auto doc = loadFixture("hunger-vectors.json");
    TEST_ASSERT_EQUAL_INT32(kFedWindowSec, doc["fedWindowSec"].as<int32_t>());
    int n = 0;
    for (JsonObject c : doc["cases"].as<JsonArray>()) {
        const bool never = c["lastFedAtMs"].isNull();
        const int64_t last = never ? 0 : c["lastFedAtMs"].as<int64_t>();
        const auto s = hungerState(c["nowMs"].as<int64_t>(), never ? nullptr : &last, c["hungryAfterSec"].as<int32_t>());
        TEST_ASSERT_EQUAL_STRING_MESSAGE(c["level"].as<const char*>(), levelName(s.level), "level");
        if (c["ratio"].isNull()) TEST_ASSERT_TRUE(std::isinf(s.ratio));
        else TEST_ASSERT_DOUBLE_WITHIN(0.001, c["ratio"].as<double>(), s.ratio);
        if (!c["ageSec"].isNull()) TEST_ASSERT_DOUBLE_WITHIN(0.001, c["ageSec"].as<double>(), s.ageSec);
        ++n;
    }
    TEST_ASSERT_GREATER_OR_EQUAL(8, n);
}

void test_hunger_colours_and_degenerate_interval() {
    TEST_ASSERT_EQUAL(LevelColor::Good, levelColor(HungerLevel::Content));
    TEST_ASSERT_EQUAL(LevelColor::Warn, levelColor(HungerLevel::Hungry));
    TEST_ASSERT_EQUAL(LevelColor::Danger, levelColor(HungerLevel::Starving));
    const int64_t last = 1000;
    TEST_ASSERT_EQUAL(HungerLevel::Starving, hungerState(2000, &last, 0).level);
}
