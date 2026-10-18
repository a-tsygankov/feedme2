#pragma once

#include <cstdint>

namespace feedme2::domain::scale {

// Pure lift/return detection over *already stable* calibrated gross weights.
// This does NOT identify a bowl or infer consumption/feeding. Any delta is
// a review-only candidate until bowl identity is independently verified.
struct BowlDetectionConfig {
    int32_t absentAtOrBelowMg;  // measured empty platform + noise margin
    int32_t presentAtOrAboveMg; // measured minimum bowl mass - noise margin
    uint64_t maxLiftMs;         // discard abandoned transitions
    int32_t maxGrossMg;         // same bench-validated limit as calibration
};

enum class BowlPhase : uint8_t { Unknown, Empty, Present, Lifted, Fault };
enum class BowlEvent : uint8_t { None, Removed, Returned };
enum class BowlFault : uint8_t { None, InvalidInput, CalibrationChanged, TimedOut };

struct BowlDetectionResult {
    BowlPhase phase = BowlPhase::Unknown;
    BowlEvent event = BowlEvent::None;
    BowlFault fault = BowlFault::None;
    int32_t beforeMg = 0;
    int32_t afterMg = 0;
    int32_t deltaMg = 0;
    // A weight difference never proves the same bowl was returned.
    bool needsReview = false;
};

class BowlLiftDetector {
public:
    explicit BowlLiftDetector(BowlDetectionConfig cfg) : cfg_(cfg) {}

    bool valid() const {
        return cfg_.absentAtOrBelowMg >= 0 &&
            cfg_.presentAtOrAboveMg > cfg_.absentAtOrBelowMg &&
            cfg_.presentAtOrAboveMg <= cfg_.maxGrossMg &&
            cfg_.maxGrossMg > 0 && cfg_.maxGrossMg <= 1000000 &&
            cfg_.maxLiftMs >= 1000 && cfg_.maxLiftMs <= 86400000;
    }

    void reset() {
        phase_ = BowlPhase::Unknown;
        revision_ = 0;
        lastMs_ = 0;
        liftedAtMs_ = 0;
        beforeMg_ = 0;
    }

    BowlPhase phase() const { return phase_; }

    BowlDetectionResult fault() {
        reset();
        phase_ = BowlPhase::Fault;
        return {phase_, BowlEvent::None, BowlFault::InvalidInput};
    }

    // Feed only stability-estimator STABLE results, with monotonic atMs.
    // Settling/ambiguous masses are not absence evidence.
    BowlDetectionResult observe(uint64_t atMs, int32_t grossMg, uint32_t revision) {
        if (!valid() || revision == 0 || revision > 2147483647u ||
            grossMg < 0 || grossMg > cfg_.maxGrossMg ||
            (revision_ != 0 && atMs < lastMs_)) return fault();

        if (revision_ != 0 && revision != revision_) {
            reset();
            phase_ = BowlPhase::Fault;
            return {phase_, BowlEvent::None, BowlFault::CalibrationChanged};
        }

        lastMs_ = atMs;
        revision_ = revision;
        const bool absent = grossMg <= cfg_.absentAtOrBelowMg;
        const bool present = grossMg >= cfg_.presentAtOrAboveMg;
        if (phase_ == BowlPhase::Lifted &&
            atMs - liftedAtMs_ > cfg_.maxLiftMs) {
            // Do not interpret a late return after reboot-like uncertainty.
            phase_ = present ? BowlPhase::Present : absent ? BowlPhase::Empty : BowlPhase::Unknown;
            beforeMg_ = present ? grossMg : 0;
            return {phase_, BowlEvent::None, BowlFault::TimedOut};
        }
        if (phase_ == BowlPhase::Unknown || phase_ == BowlPhase::Fault) {
            if (present) {
                phase_ = BowlPhase::Present;
                beforeMg_ = grossMg;
            } else if (absent) phase_ = BowlPhase::Empty;
            return {phase_};
        }
        if (phase_ == BowlPhase::Empty) {
            if (present) {
                phase_ = BowlPhase::Present;
                beforeMg_ = grossMg;
            }
            return {phase_}; // first placement is NOT a bowl return
        }
        if (phase_ == BowlPhase::Present) {
            if (absent) {
                phase_ = BowlPhase::Lifted;
                liftedAtMs_ = atMs;
                return {phase_, BowlEvent::Removed, BowlFault::None, beforeMg_};
            }
            if (present) beforeMg_ = grossMg; // latest stable pre-lift mass
            return {phase_};
        }
        if (present) {
            phase_ = BowlPhase::Present;
            const int32_t previous = beforeMg_;
            beforeMg_ = grossMg;
            return {phase_, BowlEvent::Returned, BowlFault::None,
                    previous, grossMg, grossMg - previous, true};
        }
        return {phase_};
    }

private:
    BowlDetectionConfig cfg_;
    BowlPhase phase_ = BowlPhase::Unknown;
    uint32_t revision_ = 0;
    uint64_t lastMs_ = 0;
    uint64_t liftedAtMs_ = 0;
    int32_t beforeMg_ = 0;
};

}  // namespace feedme2::domain::scale
