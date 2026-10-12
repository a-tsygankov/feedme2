#include <unity.h>
#include <cstring>
#include "domain/Units.h"
#include "fixtures.h"

using namespace feedme2::domain;

void test_units_fixture_loads() {
    auto doc = loadFixture("unit-vectors.json");
    TEST_ASSERT_FALSE_MESSAGE(doc["__error"].is<const char*>(), doc["__error"] | "parse error");
    TEST_ASSERT_EQUAL_DOUBLE(kMgPerOz, doc["mgPerOz"].as<double>());
    TEST_ASSERT_EQUAL_INT32(kDefaultCanMg, doc["defaultCanMg"].as<int32_t>());
}

void test_units_to_mg_matches_every_vector() {
    auto doc = loadFixture("unit-vectors.json");
    int n = 0;
    for (JsonObject v : doc["toMg"].as<JsonArray>()) {
        const int32_t got = toMg(v["value"].as<double>(), parseUnit(v["unit"]), v["canSizeMg"].as<int32_t>());
        TEST_ASSERT_EQUAL_INT32_MESSAGE(v["mg"].as<int32_t>(), got, v["unit"].as<const char*>());
        ++n;
    }
    TEST_ASSERT_GREATER_OR_EQUAL(6, n);
}

void test_units_step_matches_every_vector() {
    auto doc = loadFixture("unit-vectors.json");
    for (JsonObject v : doc["steps"].as<JsonArray>()) {
        StepSettings s{v["gramStep"].as<int>(), v["ozStepHundredths"].as<int>(), parseFraction(v["canFractionStep"]), v["canSizeMg"].as<int32_t>()};
        TEST_ASSERT_EQUAL_INT32_MESSAGE(v["stepMg"].as<int32_t>(), stepMg(parseUnit(v["unit"]), s), v["unit"].as<const char*>());
    }
}

void test_units_snap_and_format() {
    TEST_ASSERT_EQUAL_INT32(40000, snapToStep(42000, 5000));
    TEST_ASSERT_EQUAL_INT32(45000, snapToStep(43000, 5000));
    TEST_ASSERT_EQUAL_INT32(5000, snapToStep(100, 5000));
    TEST_ASSERT_EQUAL_STRING("40 g", formatAmountAscii(40000, FoodUnit::Grams, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("1.5 oz", formatAmountAscii(42524, FoodUnit::Ounces, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("1/3 can", formatAmountAscii(51974, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("1 1/2 can", formatAmountAscii(233883, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("1 can", formatAmountAscii(155922, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("0.27 can", formatAmountAscii(42255, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("52 g", formatAmountAscii(51974, FoodUnit::Grams, kDefaultCanMg).c_str());
}

void test_units_round_half_away_from_zero() {
    // 0.25 can of 155922 mg is 38980.5 → 38981 (std::lround), never 38980.
    TEST_ASSERT_EQUAL_INT32(38981, toMg(0.25, FoodUnit::Cans, kDefaultCanMg));
}
