#pragma once
#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>
#include "domain/Units.h"

namespace feedme2::domain {

struct HouseSettings {
    FoodUnit foodUnit = FoodUnit::Grams;
    int32_t canSizeMg = kDefaultCanMg;
    CanFraction canFractionStep = CanFraction::Quarter;
    int gramStep = 5;
    int ozStepHundredths = 25;
    int32_t hungryAfterSecDefault = 18000;
    int32_t sleepTimeoutSec = 300;
    int32_t syncIntervalSec = 21600;
    std::string timezone = "UTC";
};

struct CatState {
    std::string id, name;
    uint32_t colorRgb = 0x4CAF50;
    std::string avatarPose = "C2";
    int32_t hungryAfterSec = 18000;
    int sortOrder = 0;
    bool hasDefault = false;
    int32_t defaultAmountMg = 0;
    FoodUnit defaultUnit = FoodUnit::Grams;
    std::string defaultValue;
    bool hasLastFed = false;
    int64_t lastFedAtMs = 0;
};

struct DeviceState {
    std::string houseId, houseName;
    int tzOffsetMin = 0;
    HouseSettings settings;
    std::string deviceId, deviceName;
    std::vector<CatState> cats;
    int64_t nowMs = 0;

    void sortCats() {
        std::stable_sort(cats.begin(), cats.end(), [](const CatState& a, const CatState& b) {
            return a.sortOrder != b.sortOrder ? a.sortOrder < b.sortOrder : a.id < b.id;
        });
    }
};

inline StepSettings stepSettingsOf(const HouseSettings& h) {
    return StepSettings{h.gramStep, h.ozStepHundredths, h.canFractionStep, h.canSizeMg};
}

}  // namespace feedme2::domain
