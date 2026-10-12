#pragma once
// The feeding state machine (spec §1.2 step 3, §5.2): Idle → Amount → Fed.
// Single cat: the knob steps the amount in the house unit. "All cats":
// the knob picks a scale and each cat gets its own default × scale.
#include <algorithm>
#include <functional>
#include <string>
#include <utility>
#include <vector>
#include "domain/DeviceState.h"
#include "domain/Units.h"

namespace feedme2::domain {

enum class Phase : uint8_t { Idle, Amount, Fed };
enum class Scale : uint8_t { Half, One, OneAndHalf };

constexpr int32_t kFallbackMg = 40000;      // a cat that was never fed: 40 g
constexpr int32_t kMaxAmountMg = 5'000'000;  // server cap (shared amountMg max)

struct FeedingDraft {
    std::string id, catId;
    int64_t fedAtMs = 0;
    int32_t amountMg = 0;
    FoodUnit unit = FoodUnit::Grams;
    std::string enteredValue;
};

class FeedFlow {
public:
    void begin(const DeviceState& s, const CatState* cat, int64_t nowMs) {
        settings_ = s.settings;
        cats_ = s.cats;
        all_ = (cat == nullptr);
        scale_ = Scale::One;
        catId_ = all_ ? "" : cat->id;
        amountMg_ = all_ ? 0 : defaultFor(*cat);
        phase_ = Phase::Amount;
        (void)nowMs;
    }
    Phase phase() const { return phase_; }
    bool isAll() const { return all_; }
    int32_t amountMg() const { return amountMg_; }
    Scale scale() const { return scale_; }

    void rotate(int delta) {
        if (phase_ != Phase::Amount) return;
        if (all_) {
            int i = static_cast<int>(scale_) + delta;
            i = std::max(0, std::min(2, i));
            scale_ = static_cast<Scale>(i);
            return;
        }
        const int32_t step = stepMg(settings_.foodUnit, stepSettingsOf(settings_));
        int64_t next = static_cast<int64_t>(amountMg_) + static_cast<int64_t>(delta) * step;
        next = std::min<int64_t>(next, kMaxAmountMg);
        amountMg_ = snapToStep(static_cast<int32_t>(std::max<int64_t>(next, step)), step);
    }

    std::string amountText() const {
        if (all_) {
            switch (scale_) { case Scale::Half: return "1/2 x"; case Scale::One: return "1 x"; case Scale::OneAndHalf: return "1 1/2 x"; }
        }
        return formatAmountAscii(amountMg_, settings_.foodUnit, settings_.canSizeMg);
    }

    std::vector<FeedingDraft> confirm(const std::function<std::string()>& newId, int64_t nowMs) {
        std::vector<FeedingDraft> out;
        if (phase_ != Phase::Amount) return out;
        if (all_) {
            for (const auto& c : cats_) out.push_back(draft(c.id, scaled(defaultFor(c)), newId(), nowMs));
        } else {
            out.push_back(draft(catId_, amountMg_, newId(), nowMs));
        }
        phase_ = Phase::Fed;
        return out;
    }
    void cancel() { phase_ = Phase::Idle; }
    void finishFed() { phase_ = Phase::Idle; }

private:
    int32_t defaultFor(const CatState& c) const {
        // The server already converted the cat's default into the house unit's mg; use it as is.
        return c.hasDefault && c.defaultAmountMg > 0 ? c.defaultAmountMg : kFallbackMg;
    }
    int32_t scaled(int32_t mg) const {
        switch (scale_) { case Scale::Half: return std::max<int32_t>(1, mg / 2); case Scale::One: return mg; case Scale::OneAndHalf: return std::min<int32_t>(kMaxAmountMg, mg + mg / 2); }
        return mg;
    }
    FeedingDraft draft(const std::string& catId, int32_t mg, std::string id, int64_t nowMs) const {
        FeedingDraft d;
        // nowMs is the device's best guess (ClockModel). Before the first server sync it may be 0: the server
        // accepts fedAt 0 on /device/feedings and clamps it (and anything before 2020 or > now + 5 min) to its own now.
        d.id = std::move(id); d.catId = catId; d.fedAtMs = nowMs; d.amountMg = mg; d.unit = settings_.foodUnit;
        // enteredValue is what the knob showed, without the unit word.
        std::string t = formatAmountAscii(mg, settings_.foodUnit, settings_.canSizeMg);
        d.enteredValue = t.substr(0, t.rfind(' '));
        return d;
    }

    HouseSettings settings_;
    std::vector<CatState> cats_;
    bool all_ = false;
    Scale scale_ = Scale::One;
    std::string catId_;
    int32_t amountMg_ = 0;
    Phase phase_ = Phase::Idle;
};

}  // namespace feedme2::domain
