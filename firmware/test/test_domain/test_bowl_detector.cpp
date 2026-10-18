#include <unity.h>
#include "domain/BowlLiftDetector.h"

using namespace feedme2::domain::scale;

namespace {
constexpr BowlDetectionConfig kConfig{5000, 60000, 300000, 900000};
BowlLiftDetector detector() { return BowlLiftDetector(kConfig); }
}

void test_bowl_first_placement_does_not_infer_return() {
    auto d = detector();
    TEST_ASSERT_TRUE(d.valid());
    TEST_ASSERT_EQUAL(BowlPhase::Empty, d.observe(100, 0, 1).phase);
    const auto first = d.observe(200, 125000, 1);
    TEST_ASSERT_EQUAL(BowlPhase::Present, first.phase);
    TEST_ASSERT_EQUAL(BowlEvent::None, first.event);
    TEST_ASSERT_EQUAL(BowlEvent::None, d.observe(300, 125010, 1).event);
}

void test_bowl_lift_return_is_review_only_positive_candidate() {
    auto d = detector();
    d.observe(100, 125000, 1);
    d.observe(200, 125010, 1);
    const auto lift = d.observe(300, 1000, 1);
    TEST_ASSERT_EQUAL(BowlPhase::Lifted, lift.phase);
    TEST_ASSERT_EQUAL(BowlEvent::Removed, lift.event);
    TEST_ASSERT_EQUAL_INT32(125010, lift.beforeMg);
    TEST_ASSERT_EQUAL(BowlEvent::None, d.observe(400, 1000, 1).event);
    const auto returned = d.observe(500, 155000, 1);
    TEST_ASSERT_EQUAL(BowlEvent::Returned, returned.event);
    TEST_ASSERT_EQUAL_INT32(125010, returned.beforeMg);
    TEST_ASSERT_EQUAL_INT32(155000, returned.afterMg);
    TEST_ASSERT_EQUAL_INT32(29990, returned.deltaMg);
    TEST_ASSERT_TRUE(returned.needsReview);
    TEST_ASSERT_EQUAL(BowlEvent::None, d.observe(600, 155000, 1).event);
}

void test_bowl_negative_delta_never_becomes_food_added() {
    auto d = detector();
    d.observe(100, 150000, 1);
    d.observe(200, 0, 1);
    const auto r = d.observe(300, 120000, 1);
    TEST_ASSERT_EQUAL(BowlEvent::Returned, r.event);
    TEST_ASSERT_EQUAL_INT32(-30000, r.deltaMg);
    TEST_ASSERT_TRUE(r.needsReview);
}

void test_bowl_hysteresis_ignores_ambiguous_mass() {
    auto d = detector();
    d.observe(100, 125000, 1);
    TEST_ASSERT_EQUAL(BowlEvent::None, d.observe(200, 25000, 1).event);
    TEST_ASSERT_EQUAL(BowlPhase::Present, d.phase());
    TEST_ASSERT_EQUAL(BowlEvent::Removed, d.observe(300, 5000, 1).event);
    TEST_ASSERT_EQUAL(BowlEvent::None, d.observe(400, 40000, 1).event);
    TEST_ASSERT_EQUAL(BowlPhase::Lifted, d.phase());
    TEST_ASSERT_EQUAL(BowlEvent::Returned, d.observe(500, 60000, 1).event);
}

void test_bowl_fault_clears_pending_lift_and_requires_new_baseline() {
    auto d = detector();
    d.observe(100, 125000, 1);
    d.observe(200, 0, 1);
    TEST_ASSERT_EQUAL(BowlPhase::Fault, d.fault().phase);
    TEST_ASSERT_EQUAL(BowlEvent::None, d.observe(300, 155000, 1).event);
    TEST_ASSERT_EQUAL(BowlPhase::Present, d.phase());
}

void test_bowl_recalibration_during_lift_cannot_create_return() {
    auto d = detector();
    d.observe(100, 125000, 1);
    d.observe(200, 0, 1);
    const auto invalid = d.observe(300, 155000, 2);
    TEST_ASSERT_EQUAL(BowlFault::CalibrationChanged, invalid.fault);
    TEST_ASSERT_EQUAL(BowlEvent::None, invalid.event);
    TEST_ASSERT_EQUAL(BowlEvent::None, d.observe(400, 155000, 2).event);
}

void test_bowl_timeout_cannot_create_phantom_return() {
    auto d = detector();
    d.observe(100, 125000, 1);
    d.observe(200, 0, 1);
    const auto late = d.observe(300201, 155000, 1);
    TEST_ASSERT_EQUAL(BowlFault::TimedOut, late.fault);
    TEST_ASSERT_EQUAL(BowlEvent::None, late.event);
    TEST_ASSERT_EQUAL(BowlPhase::Present, late.phase);
}

void test_bowl_restart_cannot_create_phantom_return() {
    auto d = detector();
    d.observe(100, 125000, 1);
    d.observe(200, 0, 1);
    d.reset();
    TEST_ASSERT_EQUAL(BowlEvent::None, d.observe(300, 155000, 1).event);
}

void test_bowl_invalid_configuration_or_input_fails_closed() {
    TEST_ASSERT_FALSE(BowlLiftDetector(BowlDetectionConfig{10000, 5000, 300000, 900000}).valid());
    TEST_ASSERT_FALSE(BowlLiftDetector(BowlDetectionConfig{5000, 60000, 0, 900000}).valid());
    auto d = detector();
    TEST_ASSERT_EQUAL(BowlFault::InvalidInput, d.observe(100, -1, 1).fault);
    d.observe(200, 125000, 1);
    TEST_ASSERT_EQUAL(BowlFault::InvalidInput, d.observe(199, 125000, 1).fault);
    TEST_ASSERT_EQUAL(BowlEvent::None, d.observe(300, 125000, 1).event);
    TEST_ASSERT_EQUAL(BowlFault::InvalidInput, d.observe(400, 900001, 1).fault);
}

void test_bowl_zero_or_negative_change_still_review_only() {
    auto d = detector();
    d.observe(100, 125000, 1);
    d.observe(200, 0, 1);
    const auto r = d.observe(300, 125000, 1);
    TEST_ASSERT_EQUAL(BowlEvent::Returned, r.event);
    TEST_ASSERT_EQUAL_INT32(0, r.deltaMg);
    TEST_ASSERT_TRUE(r.needsReview);
}
