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

// Task 16 edge cases. A can amount a hair under a whole number reads as the whole number: the
// 0.02 tolerance decides the glyph, and "%.2f" rounds the rest ("1.00" -> "1").
void test_units_can_format_rounds_near_whole_to_whole() {
    TEST_ASSERT_EQUAL_STRING("1 can", formatAmountAscii(toMg(0.9999, FoodUnit::Cans, kDefaultCanMg), FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("2 can", formatAmountAscii(toMg(1.999, FoodUnit::Cans, kDefaultCanMg), FoodUnit::Cans, kDefaultCanMg).c_str());
    // A whole plus a hair (1.01 can) is inside the tolerance of the whole, never "1 0.01 can".
    TEST_ASSERT_EQUAL_STRING("1 can", formatAmountAscii(toMg(1.01, FoodUnit::Cans, kDefaultCanMg), FoodUnit::Cans, kDefaultCanMg).c_str());
}

void test_units_can_format_tiny_amount_two_decimals() {
    TEST_ASSERT_EQUAL_STRING("0.01 can", formatAmountAscii(1560, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("0 can", formatAmountAscii(0, FoodUnit::Cans, kDefaultCanMg).c_str());
    // 0.1 can is no glyph: two decimals, not the nearest quarter.
    TEST_ASSERT_EQUAL_STRING("0.1 can", formatAmountAscii(toMg(0.1, FoodUnit::Cans, kDefaultCanMg), FoodUnit::Cans, kDefaultCanMg).c_str());
    // The can size decides the glyph: the same 1560 mg is 1/4 of a 6240 mg can.
    TEST_ASSERT_EQUAL_STRING("1/4 can", formatAmountAscii(1560, FoodUnit::Cans, 6240).c_str());
}

void test_units_oz_format_two_decimals_trims_zeros() {
    TEST_ASSERT_EQUAL_STRING("1.25 oz", formatAmountAscii(toMg(1.25, FoodUnit::Ounces, kDefaultCanMg), FoodUnit::Ounces, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("2 oz", formatAmountAscii(toMg(2.0, FoodUnit::Ounces, kDefaultCanMg), FoodUnit::Ounces, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("0.5 oz", formatAmountAscii(toMg(0.5, FoodUnit::Ounces, kDefaultCanMg), FoodUnit::Ounces, kDefaultCanMg).c_str());
    // The third decimal rounds, never truncates (1.006 oz, clear of the .5 tie that IEEE may land either side of).
    TEST_ASSERT_EQUAL_STRING("1.01 oz", formatAmountAscii(toMg(1.006, FoodUnit::Ounces, kDefaultCanMg), FoodUnit::Ounces, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("0 oz", formatAmountAscii(1, FoodUnit::Ounces, kDefaultCanMg).c_str());
    // Grams never show a fraction and round half away from zero.
    TEST_ASSERT_EQUAL_STRING("3 g", formatAmountAscii(2500, FoodUnit::Grams, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("2 g", formatAmountAscii(2499, FoodUnit::Grams, kDefaultCanMg).c_str());
}

void test_units_every_fraction_glyph() {
    TEST_ASSERT_EQUAL_STRING("1/4", feedme2::domain::detail::fractionText(0.25));
    TEST_ASSERT_EQUAL_STRING("1/3", feedme2::domain::detail::fractionText(1.0 / 3));
    TEST_ASSERT_EQUAL_STRING("1/2", feedme2::domain::detail::fractionText(0.5));
    TEST_ASSERT_EQUAL_STRING("2/3", feedme2::domain::detail::fractionText(2.0 / 3));
    TEST_ASSERT_EQUAL_STRING("3/4", feedme2::domain::detail::fractionText(0.75));
    TEST_ASSERT_NULL(feedme2::domain::detail::fractionText(0.1));
    TEST_ASSERT_NULL(feedme2::domain::detail::fractionText(0.9));
    // The tolerance is a strict 0.02: 0.269 is a quarter, 0.28 is not.
    TEST_ASSERT_EQUAL_STRING("1/4", feedme2::domain::detail::fractionText(0.269));
    TEST_ASSERT_NULL(feedme2::domain::detail::fractionText(0.28));
    // Through the formatter: each glyph at its mg, alone and after a whole can.
    TEST_ASSERT_EQUAL_STRING("1/4 can", formatAmountAscii(38981, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("1/2 can", formatAmountAscii(77961, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("2/3 can", formatAmountAscii(103948, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("3/4 can", formatAmountAscii(116942, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("2 3/4 can", formatAmountAscii(428786, FoodUnit::Cans, kDefaultCanMg).c_str());
    TEST_ASSERT_EQUAL_STRING("3 1/3 can", formatAmountAscii(toMg(3 + 1.0 / 3, FoodUnit::Cans, kDefaultCanMg), FoodUnit::Cans, kDefaultCanMg).c_str());
}

void test_units_snap_step_zero_or_negative_returns_input() {
    TEST_ASSERT_EQUAL_INT32(42000, snapToStep(42000, 0));
    TEST_ASSERT_EQUAL_INT32(42000, snapToStep(42000, -5000));
    TEST_ASSERT_EQUAL_INT32(0, snapToStep(0, 0));
    // With a real step: an exact multiple is unchanged, zero rises to one step, the midpoint rounds up.
    TEST_ASSERT_EQUAL_INT32(45000, snapToStep(45000, 5000));
    TEST_ASSERT_EQUAL_INT32(5000, snapToStep(0, 5000));
    TEST_ASSERT_EQUAL_INT32(45000, snapToStep(42500, 5000));
}

void test_units_parse_labels_round_trip_and_unknown_defaults() {
    TEST_ASSERT_EQUAL(FoodUnit::Grams, parseUnit(unitLabel(FoodUnit::Grams)));
    TEST_ASSERT_EQUAL(FoodUnit::Ounces, parseUnit(unitLabel(FoodUnit::Ounces)));
    TEST_ASSERT_EQUAL(FoodUnit::Cans, parseUnit(unitLabel(FoodUnit::Cans)));
    TEST_ASSERT_EQUAL(FoodUnit::Grams, parseUnit("cups"));
    TEST_ASSERT_EQUAL(FoodUnit::Grams, parseUnit(nullptr));
    TEST_ASSERT_EQUAL(CanFraction::Third, parseFraction("1/3"));
    TEST_ASSERT_EQUAL(CanFraction::Half, parseFraction("1/2"));
    TEST_ASSERT_EQUAL(CanFraction::Quarter, parseFraction("1/4"));
    TEST_ASSERT_EQUAL(CanFraction::Quarter, parseFraction("1/5"));
    TEST_ASSERT_EQUAL(CanFraction::Quarter, parseFraction(nullptr));
    TEST_ASSERT_EQUAL_INT(4, fractionDenominator(CanFraction::Quarter));
    TEST_ASSERT_EQUAL_INT(3, fractionDenominator(CanFraction::Third));
    TEST_ASSERT_EQUAL_INT(2, fractionDenominator(CanFraction::Half));
}
