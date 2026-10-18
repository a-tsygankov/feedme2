#pragma once

#include <cstdint>

namespace feedme2::domain::scale {

struct Calibration {
    int32_t zeroRaw = 0;        // raw ADC count at known zero load
    int32_t referenceRaw = 0;   // raw ADC count with certified reference
    int32_t referenceMg = 0;    // reference mass in integer milligrams
    int32_t maxGrossMg = 0;     // bench-validated ceiling, <= 1 kg
    uint32_t revision = 0;      // increment whenever calibration changes
};

enum class CalibrationStatus : uint8_t {
    Ok, InvalidCalibration, AdcSaturated, NegativeMass, Overload
};

class ScaleCalibration {
public:
    static constexpr int32_t kRawMin = -8388608;
    static constexpr int32_t kRawMax = 8388607;

    explicit ScaleCalibration(Calibration c) : cfg_(c) {}

    bool valid() const {
        return cfg_.revision > 0 && cfg_.revision <= 2147483647u &&
            cfg_.zeroRaw > kRawMin && cfg_.zeroRaw < kRawMax &&
            cfg_.referenceRaw > kRawMin && cfg_.referenceRaw < kRawMax &&
            cfg_.zeroRaw != cfg_.referenceRaw &&
            cfg_.referenceMg > 0 && cfg_.referenceMg <= 1000000 &&
            cfg_.maxGrossMg > 0 && cfg_.maxGrossMg <= 1000000;
    }

    // No automatic tare. In particular, NEVER zero a bowl that may contain
    // food; doing so silently loses the mass history.
    CalibrationStatus convert(int32_t raw, int32_t& grossMg) const {
        if (!valid()) return CalibrationStatus::InvalidCalibration;
        if (raw <= kRawMin || raw >= kRawMax) return CalibrationStatus::AdcSaturated;
        const int64_t delta = static_cast<int64_t>(raw) - cfg_.zeroRaw;
        const int64_t span = static_cast<int64_t>(cfg_.referenceRaw) - cfg_.zeroRaw;
        const int64_t numerator = delta * cfg_.referenceMg;
        // Round to nearest mg, ties away from zero, including reversed
        // load-cell wiring (negative calibration span).
        const int64_t absNum = numerator < 0 ? -numerator : numerator;
        const int64_t absSpan = span < 0 ? -span : span;
        const int64_t magnitude = (absNum + absSpan / 2) / absSpan;
        const int64_t mg = ((numerator < 0) != (span < 0)) ? -magnitude : magnitude;
        if (mg < 0) return CalibrationStatus::NegativeMass;
        if (mg > cfg_.maxGrossMg) return CalibrationStatus::Overload;
        grossMg = static_cast<int32_t>(mg);
        return CalibrationStatus::Ok;
    }

    const Calibration& config() const { return cfg_; }

private:
    Calibration cfg_;
};

}  // namespace feedme2::domain::scale
