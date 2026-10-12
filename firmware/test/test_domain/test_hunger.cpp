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
    // Negative is as degenerate as zero, and the age still reads for the "fed N ago" line.
    const auto neg = hungerState(2000, &last, -1);
    TEST_ASSERT_EQUAL(HungerLevel::Starving, neg.level);
    TEST_ASSERT_TRUE(std::isinf(neg.ratio));
    TEST_ASSERT_DOUBLE_WITHIN(0.0001, 1.0, neg.ageSec);
}

// Task 16: each level boundary pinned one millisecond either side. hungryAfter 10 000 s puts the
// fed window (900 s) well before the first ratio boundary (0.5 -> 5 000 s), so each threshold is
// its own. The thresholds are half-open on the hungrier side: exactly 0.5 is peckish, not content.
void test_hunger_level_boundaries_within_one_ms() {
    const int64_t last = 1'000'000'000'000LL;
    const int32_t after = 10'000;
    auto levelAt = [&](int64_t ageMs) { return hungerState(last + ageMs, &last, after).level; };
    TEST_ASSERT_EQUAL(HungerLevel::Fed, levelAt(899'999));
    TEST_ASSERT_EQUAL(HungerLevel::Content, levelAt(900'000));
    TEST_ASSERT_EQUAL(HungerLevel::Content, levelAt(4'999'999));
    TEST_ASSERT_EQUAL(HungerLevel::Peckish, levelAt(5'000'000));
    TEST_ASSERT_EQUAL(HungerLevel::Peckish, levelAt(7'499'999));
    TEST_ASSERT_EQUAL(HungerLevel::Hungry, levelAt(7'500'000));
    TEST_ASSERT_EQUAL(HungerLevel::Hungry, levelAt(9'999'999));
    TEST_ASSERT_EQUAL(HungerLevel::VeryHungry, levelAt(10'000'000));
    TEST_ASSERT_EQUAL(HungerLevel::VeryHungry, levelAt(14'999'999));
    TEST_ASSERT_EQUAL(HungerLevel::Starving, levelAt(15'000'000));
    // The fed window wins over the ratio: a short interval is still "fed" for its first 15 minutes,
    // then jumps straight to where the ratio says.
    TEST_ASSERT_EQUAL(HungerLevel::Fed, hungerState(last + 899'999, &last, 700).level);
    TEST_ASSERT_EQUAL(HungerLevel::VeryHungry, hungerState(last + 900'000, &last, 700).level);   // ratio 1.29
}

void test_hunger_level_names_and_colours_for_all_six() {
    TEST_ASSERT_EQUAL_STRING("fed", levelName(HungerLevel::Fed));
    TEST_ASSERT_EQUAL_STRING("content", levelName(HungerLevel::Content));
    TEST_ASSERT_EQUAL_STRING("peckish", levelName(HungerLevel::Peckish));
    TEST_ASSERT_EQUAL_STRING("hungry", levelName(HungerLevel::Hungry));
    TEST_ASSERT_EQUAL_STRING("very_hungry", levelName(HungerLevel::VeryHungry));
    TEST_ASSERT_EQUAL_STRING("starving", levelName(HungerLevel::Starving));
    TEST_ASSERT_EQUAL(LevelColor::Good, levelColor(HungerLevel::Fed));
    TEST_ASSERT_EQUAL(LevelColor::Good, levelColor(HungerLevel::Content));
    TEST_ASSERT_EQUAL(LevelColor::Warn, levelColor(HungerLevel::Peckish));
    TEST_ASSERT_EQUAL(LevelColor::Warn, levelColor(HungerLevel::Hungry));
    TEST_ASSERT_EQUAL(LevelColor::Danger, levelColor(HungerLevel::VeryHungry));
    TEST_ASSERT_EQUAL(LevelColor::Danger, levelColor(HungerLevel::Starving));
    // The enum order is the hunger order: App picks the hungriest cat for "All" with std::max.
    TEST_ASSERT_TRUE(HungerLevel::Fed < HungerLevel::Content && HungerLevel::Content < HungerLevel::Peckish);
    TEST_ASSERT_TRUE(HungerLevel::Peckish < HungerLevel::Hungry && HungerLevel::Hungry < HungerLevel::VeryHungry);
    TEST_ASSERT_TRUE(HungerLevel::VeryHungry < HungerLevel::Starving);
}
