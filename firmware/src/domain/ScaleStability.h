#pragma once

#include <algorithm>
#include <array>
#include <cstdint>

namespace feedme2::domain::scale {

// C++ reference of shared/src/weight-stability.ts. Parameters must come from
// actual bench measurements; there are intentionally no production defaults.
struct StabilityConfig {
    uint16_t minSamples;
    uint32_t minDwellMs;
    int32_t maxSpreadMg;
    uint32_t maxSampleGapMs;
    int32_t maxGrossMg;
};

struct WeightSample {
    uint64_t atMs;              // monotonic time, never UTC
    int32_t grossMg;            // calibrated gross mass, NOT food consumed
    uint32_t calibrationRevision;
};

enum class StabilityStatus : uint8_t { Settling, Stable, Fault };
enum class StabilityFault : uint8_t { None, InvalidSample, Overload };

struct StabilityResult {
    StabilityStatus status = StabilityStatus::Settling;
    StabilityFault fault = StabilityFault::None;
    int32_t grossMg = 0;
    uint32_t calibrationRevision = 0;
    uint64_t sinceMs = 0;
    uint16_t sampleCount = 0;
    int32_t spreadMg = 0;
};

class WeightStabilityEstimator {
public:
    static constexpr uint16_t kMaxSamples = 256;

    explicit WeightStabilityEstimator(StabilityConfig cfg) : cfg_(cfg) {
        valid_ = cfg_.minSamples >= 2 && cfg_.minSamples <= kMaxSamples &&
            cfg_.minDwellMs <= 60000 && cfg_.maxSpreadMg >= 0 &&
            cfg_.maxSpreadMg <= 1000000 && cfg_.maxSampleGapMs >= 1 &&
            cfg_.maxSampleGapMs <= 60000 && cfg_.maxGrossMg >= 1 &&
            cfg_.maxGrossMg <= 1000000;
    }

    bool valid() const { return valid_; }

    void reset() {
        count_ = 0;
        firstMs_ = 0;
        lastMs_ = 0;
        revision_ = 0;
        minMg_ = maxMg_ = 0;
    }

    StabilityResult add(const WeightSample& s) {
        if (!valid_ || s.calibrationRevision == 0 || s.calibrationRevision > 2147483647u ||
            (count_ != 0 && s.atMs < lastMs_) || s.grossMg < 0) {
            reset();
            return fault(StabilityFault::InvalidSample);
        }
        if (s.grossMg > cfg_.maxGrossMg) {
            reset();
            return fault(StabilityFault::Overload);
        }

        const bool gap = count_ != 0 && s.atMs - lastMs_ > cfg_.maxSampleGapMs;
        const bool recalibrated = count_ != 0 && revision_ != s.calibrationRevision;
        const bool spread = count_ != 0 &&
            static_cast<int64_t>(std::max(maxMg_, s.grossMg)) -
            std::min(minMg_, s.grossMg) > cfg_.maxSpreadMg;
        if (count_ == 0 || gap || recalibrated || spread) {
            count_ = 1;
            samples_[0] = s.grossMg;
            firstMs_ = s.atMs;
            minMg_ = maxMg_ = s.grossMg;
        } else {
            if (count_ == kMaxSamples) {
                // Match TS: retain conservative min/max and original candidate
                // start, but use the most recent 256 readings for the median.
                std::move(samples_.begin() + 1, samples_.end(), samples_.begin());
                samples_[kMaxSamples - 1] = s.grossMg;
            } else {
                samples_[count_++] = s.grossMg;
            }
            minMg_ = std::min(minMg_, s.grossMg);
            maxMg_ = std::max(maxMg_, s.grossMg);
        }
        lastMs_ = s.atMs;
        revision_ = s.calibrationRevision;

        StabilityResult out;
        out.sampleCount = count_;
        out.spreadMg = maxMg_ - minMg_;
        if (count_ < cfg_.minSamples || s.atMs - firstMs_ < cfg_.minDwellMs) return out;

        std::array<int32_t, kMaxSamples> sorted = samples_;
        std::sort(sorted.begin(), sorted.begin() + count_);
        const size_t middle = count_ / 2;
        out.status = StabilityStatus::Stable;
        out.grossMg = count_ % 2 ? sorted[middle]
            : static_cast<int32_t>((static_cast<int64_t>(sorted[middle - 1]) + sorted[middle] + 1) / 2);
        out.calibrationRevision = s.calibrationRevision;
        out.sinceMs = firstMs_;
        return out;
    }

private:
    static StabilityResult fault(StabilityFault code) {
        StabilityResult out;
        out.status = StabilityStatus::Fault;
        out.fault = code;
        return out;
    }

    StabilityConfig cfg_;
    bool valid_ = false;
    std::array<int32_t, kMaxSamples> samples_{};
    uint16_t count_ = 0;
    uint64_t firstMs_ = 0;
    uint64_t lastMs_ = 0;
    uint32_t revision_ = 0;
    int32_t minMg_ = 0;
    int32_t maxMg_ = 0;
};

}  // namespace feedme2::domain::scale
