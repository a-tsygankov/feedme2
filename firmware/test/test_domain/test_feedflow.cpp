#include <unity.h>
#include "domain/FeedFlow.h"
using namespace feedme2::domain;

static DeviceState house() {
    DeviceState s;
    s.settings.foodUnit = FoodUnit::Grams; s.settings.gramStep = 5; s.settings.canSizeMg = kDefaultCanMg; s.settings.canFractionStep = CanFraction::Quarter; s.settings.ozStepHundredths = 25;
    CatState a; a.id = "a"; a.name = "Mochi"; a.hasDefault = true; a.defaultAmountMg = 40000; a.defaultUnit = FoodUnit::Grams; a.defaultValue = "40";
    CatState b; b.id = "b"; b.name = "Luna"; b.hasDefault = false;
    s.cats = {a, b};
    return s;
}
static std::string nextId() { static int n = 0; return "id-" + std::to_string(++n); }

void test_feedflow_single_cat_steps_in_house_unit_and_confirms_one_draft() {
    auto s = house();
    FeedFlow f; f.begin(s, &s.cats[0], 1000);
    TEST_ASSERT_EQUAL(Phase::Amount, f.phase());
    TEST_ASSERT_EQUAL_INT32(40000, f.amountMg());
    f.rotate(1); TEST_ASSERT_EQUAL_INT32(45000, f.amountMg());
    f.rotate(-3); TEST_ASSERT_EQUAL_INT32(30000, f.amountMg());
    TEST_ASSERT_EQUAL_STRING("30 g", f.amountText().c_str());
    auto drafts = f.confirm(nextId, 2000);
    TEST_ASSERT_EQUAL(Phase::Fed, f.phase());
    TEST_ASSERT_EQUAL_UINT32(1, drafts.size());
    TEST_ASSERT_EQUAL_STRING("a", drafts[0].catId.c_str());
    TEST_ASSERT_EQUAL_INT32(30000, drafts[0].amountMg);
    TEST_ASSERT_EQUAL_STRING("30", drafts[0].enteredValue.c_str());
    TEST_ASSERT_EQUAL_INT64(2000, drafts[0].fedAtMs);
    f.finishFed(); TEST_ASSERT_EQUAL(Phase::Idle, f.phase());
}

void test_feedflow_cat_without_default_starts_at_fallback_and_never_below_one_step() {
    auto s = house();
    FeedFlow f; f.begin(s, &s.cats[1], 1000);
    TEST_ASSERT_EQUAL_INT32(kFallbackMg, f.amountMg());
    for (int i = 0; i < 100; ++i) f.rotate(-1);
    TEST_ASSERT_EQUAL_INT32(5000, f.amountMg());
    for (int i = 0; i < 100000; ++i) f.rotate(1);
    TEST_ASSERT_TRUE(f.amountMg() <= kMaxAmountMg);
}

void test_feedflow_all_cats_uses_scale_and_each_cats_default() {
    auto s = house();
    FeedFlow f; f.begin(s, nullptr, 1000);
    TEST_ASSERT_TRUE(f.isAll());
    TEST_ASSERT_EQUAL(Scale::One, f.scale());
    TEST_ASSERT_EQUAL_STRING("1 x", f.amountText().c_str());
    f.rotate(1); TEST_ASSERT_EQUAL(Scale::OneAndHalf, f.scale());
    f.rotate(1); TEST_ASSERT_EQUAL(Scale::OneAndHalf, f.scale());  // clamps
    f.rotate(-2); TEST_ASSERT_EQUAL(Scale::Half, f.scale());
    auto drafts = f.confirm(nextId, 3000);
    TEST_ASSERT_EQUAL_UINT32(2, drafts.size());
    TEST_ASSERT_EQUAL_INT32(20000, drafts[0].amountMg);   // Mochi 40 g × ½
    TEST_ASSERT_EQUAL_INT32(20000, drafts[1].amountMg);   // Luna: fallback 40 g × ½ (Review Focus 5)
    TEST_ASSERT_EQUAL_STRING("20", drafts[1].enteredValue.c_str());
}

void test_feedflow_can_unit_formats_fraction_steps() {
    auto s = house(); s.settings.foodUnit = FoodUnit::Cans; s.settings.canFractionStep = CanFraction::Third;
    s.cats[0].defaultAmountMg = 51974; s.cats[0].defaultUnit = FoodUnit::Cans; s.cats[0].defaultValue = "1/3";
    FeedFlow f; f.begin(s, &s.cats[0], 0);
    TEST_ASSERT_EQUAL_STRING("1/3 can", f.amountText().c_str());
    f.rotate(2);
    TEST_ASSERT_EQUAL_STRING("1 can", f.amountText().c_str());
    auto d = f.confirm(nextId, 1);
    TEST_ASSERT_EQUAL_STRING("1", d[0].enteredValue.c_str());
    TEST_ASSERT_EQUAL(FoodUnit::Cans, d[0].unit);
}

void test_feedflow_cancel_returns_to_idle_without_drafts() {
    auto s = house();
    FeedFlow f; f.begin(s, &s.cats[0], 0);
    f.cancel();
    TEST_ASSERT_EQUAL(Phase::Idle, f.phase());
}

void test_feedflow_oz_unit_never_overshoots_cap_and_stays_on_grid() {
    // Review (Tasks 2-4): clamping before snapToStep let a 0.25 oz step land a few grams above the
    // server cap (5 003 422 mg), which /device/feedings rejects. Snap first, then clamp down onto the grid.
    auto s = house(); s.settings.foodUnit = FoodUnit::Ounces; s.settings.ozStepHundredths = 25;
    const int32_t step = stepMg(FoodUnit::Ounces, stepSettingsOf(s.settings));  // 7087 mg
    FeedFlow f; f.begin(s, &s.cats[0], 0);
    for (int i = 0; i < 1000; ++i) f.rotate(1);
    TEST_ASSERT_TRUE(f.amountMg() <= kMaxAmountMg);
    TEST_ASSERT_EQUAL_INT32((kMaxAmountMg / step) * step, f.amountMg());
    TEST_ASSERT_EQUAL_INT32(0, f.amountMg() % step);
    f.rotate(1);  // already at the cap: stays put, still on the grid
    TEST_ASSERT_EQUAL_INT32((kMaxAmountMg / step) * step, f.amountMg());
}

void test_feedflow_begin_snaps_fallback_to_the_unit_grid() {
    // Review (Tasks 2-4): the 40 000 mg fallback read "1/4 can" but was logged as 40 000 mg, so the
    // enteredValue and amountMg disagreed. The starting amount lands on the step grid of the house unit.
    auto s = house(); s.settings.foodUnit = FoodUnit::Cans; s.settings.canFractionStep = CanFraction::Quarter;
    const int32_t step = stepMg(FoodUnit::Cans, stepSettingsOf(s.settings));  // 38981 mg
    FeedFlow f; f.begin(s, &s.cats[1], 0);  // Luna has no default
    TEST_ASSERT_EQUAL_INT32(step, f.amountMg());
    TEST_ASSERT_EQUAL_STRING("1/4 can", f.amountText().c_str());
    auto d = f.confirm(nextId, 1);
    TEST_ASSERT_EQUAL_INT32(step, d[0].amountMg);
    TEST_ASSERT_EQUAL_STRING("1/4", d[0].enteredValue.c_str());
}
