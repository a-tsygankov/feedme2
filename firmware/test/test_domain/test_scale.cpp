#include <unity.h>
#include "domain/ScaleStability.h"
#include "domain/ScaleCalibration.h"

using namespace feedme2::domain::scale;

namespace {
constexpr StabilityConfig cfg{3, 2000, 100, 1500, 900000};
WeightSample s(uint64_t at, int32_t mg = 125000, uint32_t rev = 1) {
    return WeightSample{at, mg, rev};
}
Calibration calibration(int32_t zero = 1000, int32_t reference = 11000) {
    return Calibration{zero, reference, 100000, 900000, 1};
}
}

void test_scale_stability_requires_samples_and_dwell() {
    WeightStabilityEstimator e(cfg);
    TEST_ASSERT_TRUE(e.valid());
    TEST_ASSERT_EQUAL(StabilityStatus::Settling, e.add(s(0)).status);
    TEST_ASSERT_EQUAL(StabilityStatus::Settling, e.add(s(1000)).status);
    const auto result = e.add(s(2000));
    TEST_ASSERT_EQUAL(StabilityStatus::Stable, result.status);
    TEST_ASSERT_EQUAL_INT32(125000, result.grossMg);
    TEST_ASSERT_EQUAL_UINT16(3, result.sampleCount);
    TEST_ASSERT_EQUAL_UINT64(0, result.sinceMs);
}

void test_scale_stability_uses_median_with_noise() {
    WeightStabilityEstimator e(cfg);
    e.add(s(0, 125000));
    e.add(s(1000, 125080));
    const auto r = e.add(s(2000, 125000));
    TEST_ASSERT_EQUAL(StabilityStatus::Stable, r.status);
    TEST_ASSERT_EQUAL_INT32(125000, r.grossMg);
    TEST_ASSERT_EQUAL_INT32(80, r.spreadMg);
}

void test_scale_stability_resets_on_mass_change() {
    WeightStabilityEstimator e(cfg);
    e.add(s(0)); e.add(s(1000));
    TEST_ASSERT_EQUAL(StabilityStatus::Stable, e.add(s(2000)).status);
    TEST_ASSERT_EQUAL_UINT16(1, e.add(s(2500, 155000)).sampleCount);
    e.add(s(3500, 155000));
    const auto r = e.add(s(4500, 155000));
    TEST_ASSERT_EQUAL(StabilityStatus::Stable, r.status);
    TEST_ASSERT_EQUAL_INT32(155000, r.grossMg);
    TEST_ASSERT_EQUAL_UINT64(2500, r.sinceMs);
}

void test_scale_stability_resets_on_gap_and_calibration() {
    WeightStabilityEstimator e(cfg);
    e.add(s(0)); e.add(s(1000));
    TEST_ASSERT_EQUAL_UINT16(1, e.add(s(3000)).sampleCount);
    e.add(s(4000));
    TEST_ASSERT_EQUAL_UINT16(1, e.add(s(5000, 125000, 2)).sampleCount);
}

void test_scale_stability_rejects_vibration() {
    WeightStabilityEstimator e(cfg);
    for (int t = 0; t <= 8000; t += 1000)
        TEST_ASSERT_EQUAL(StabilityStatus::Settling,
            e.add(s(t, t % 2000 ? 125200 : 125000)).status);
}

void test_scale_stability_fault_resets_candidate() {
    WeightStabilityEstimator e(cfg);
    e.add(s(0)); e.add(s(1000));
    const auto f = e.add(s(2000, 900001));
    TEST_ASSERT_EQUAL(StabilityStatus::Fault, f.status);
    TEST_ASSERT_EQUAL(StabilityFault::Overload, f.fault);
    TEST_ASSERT_EQUAL_UINT16(1, e.add(s(3000)).sampleCount);
    const auto invalid = e.add(s(4000, -1));
    TEST_ASSERT_EQUAL(StabilityFault::InvalidSample, invalid.fault);
}

void test_scale_stability_rejects_time_reversal_and_invalid_config() {
    WeightStabilityEstimator e(cfg);
    e.add(s(1000));
    TEST_ASSERT_EQUAL(StabilityFault::InvalidSample, e.add(s(999)).fault);
    TEST_ASSERT_FALSE(WeightStabilityEstimator(StabilityConfig{1, 2000, 100, 1500, 900000}).valid());
    TEST_ASSERT_FALSE(WeightStabilityEstimator(StabilityConfig{3, 2000, -1, 1500, 900000}).valid());
    TEST_ASSERT_FALSE(WeightStabilityEstimator(StabilityConfig{3, 2000, 100, 0, 900000}).valid());
}

void test_scale_stability_reset_on_reboot() {
    WeightStabilityEstimator e(cfg);
    e.add(s(0)); e.add(s(1000));
    e.reset();
    TEST_ASSERT_EQUAL_UINT16(1, e.add(s(0)).sampleCount);
}

void test_scale_stability_even_median_rounds_up() {
    WeightStabilityEstimator e(StabilityConfig{2, 1000, 100, 1500, 900000});
    e.add(s(0, 125000));
    TEST_ASSERT_EQUAL_INT32(125001, e.add(s(1000, 125001)).grossMg);
}

void test_scale_calibration_two_point_and_reverse_polarity() {
    ScaleCalibration normal(calibration());
    TEST_ASSERT_TRUE(normal.valid());
    int32_t mg = -1;
    TEST_ASSERT_EQUAL(CalibrationStatus::Ok, normal.convert(1000, mg));
    TEST_ASSERT_EQUAL_INT32(0, mg);
    TEST_ASSERT_EQUAL(CalibrationStatus::Ok, normal.convert(6000, mg));
    TEST_ASSERT_EQUAL_INT32(50000, mg);
    TEST_ASSERT_EQUAL(CalibrationStatus::Ok, normal.convert(11000, mg));
    TEST_ASSERT_EQUAL_INT32(100000, mg);
    ScaleCalibration reversed(calibration(11000, 1000));
    TEST_ASSERT_EQUAL(CalibrationStatus::Ok, reversed.convert(6000, mg));
    TEST_ASSERT_EQUAL_INT32(50000, mg);
}

void test_scale_calibration_rejects_invalid_and_rail() {
    int32_t mg = 123;
    TEST_ASSERT_FALSE(ScaleCalibration(Calibration{100, 100, 100000, 900000, 1}).valid());
    TEST_ASSERT_EQUAL(CalibrationStatus::InvalidCalibration,
        ScaleCalibration(Calibration{}).convert(1000, mg));
    ScaleCalibration c(calibration());
    TEST_ASSERT_EQUAL(CalibrationStatus::AdcSaturated, c.convert(-8388608, mg));
    TEST_ASSERT_EQUAL(CalibrationStatus::AdcSaturated, c.convert(8388607, mg));
    TEST_ASSERT_EQUAL_INT32(123, mg);
}

void test_scale_calibration_negative_and_overload() {
    ScaleCalibration c(calibration());
    int32_t mg = 0;
    TEST_ASSERT_EQUAL(CalibrationStatus::NegativeMass, c.convert(900, mg));
    TEST_ASSERT_EQUAL(CalibrationStatus::Overload, c.convert(100001, mg));
}

void test_scale_calibration_half_milligram_rounds_up() {
    ScaleCalibration c(Calibration{100, 300, 101, 1000000, 1});
    int32_t mg = 0;
    TEST_ASSERT_EQUAL(CalibrationStatus::Ok, c.convert(200, mg));
    TEST_ASSERT_EQUAL_INT32(51, mg);
}
