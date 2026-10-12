#pragma once
// Mirror of shared/src/units.ts (spec §1.5). Both assert
// fixtures/unit-vectors.json; change them together. Values are IEEE
// doubles and rounding is half-away-from-zero (std::lround), matching
// Math.round on positive numbers.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>

namespace feedme2::domain {

enum class FoodUnit : uint8_t { Grams, Ounces, Cans };
enum class CanFraction : uint8_t { Quarter, Third, Half };

constexpr double kMgPerOz = 28349.5;
constexpr int32_t kDefaultCanMg = 155922;

struct StepSettings {
    int gramStep = 5;
    int ozStepHundredths = 25;
    CanFraction canFraction = CanFraction::Quarter;
    int32_t canSizeMg = kDefaultCanMg;
};

inline const char* unitLabel(FoodUnit u) {
    switch (u) { case FoodUnit::Grams: return "g"; case FoodUnit::Ounces: return "oz"; case FoodUnit::Cans: return "can"; }
    return "g";
}
inline FoodUnit parseUnit(const char* s) {
    if (s && std::strcmp(s, "oz") == 0) return FoodUnit::Ounces;
    if (s && std::strcmp(s, "can") == 0) return FoodUnit::Cans;
    return FoodUnit::Grams;
}
inline CanFraction parseFraction(const char* s) {
    if (s && std::strcmp(s, "1/3") == 0) return CanFraction::Third;
    if (s && std::strcmp(s, "1/2") == 0) return CanFraction::Half;
    return CanFraction::Quarter;
}
inline int fractionDenominator(CanFraction f) {
    switch (f) { case CanFraction::Quarter: return 4; case CanFraction::Third: return 3; case CanFraction::Half: return 2; }
    return 4;
}

inline double unitMg(FoodUnit u, int32_t canSizeMg) {
    switch (u) { case FoodUnit::Grams: return 1000.0; case FoodUnit::Ounces: return kMgPerOz; case FoodUnit::Cans: return static_cast<double>(canSizeMg); }
    return 1000.0;
}

inline int32_t toMg(double value, FoodUnit u, int32_t canSizeMg) {
    return static_cast<int32_t>(std::lround(value * unitMg(u, canSizeMg)));
}
inline double fromMg(int32_t mg, FoodUnit u, int32_t canSizeMg) {
    return static_cast<double>(mg) / unitMg(u, canSizeMg);
}

inline int32_t stepMg(FoodUnit u, const StepSettings& s) {
    switch (u) {
        case FoodUnit::Grams: return static_cast<int32_t>(std::lround(s.gramStep * 1000.0));
        case FoodUnit::Ounces: return static_cast<int32_t>(std::lround((s.ozStepHundredths / 100.0) * kMgPerOz));
        case FoodUnit::Cans: return static_cast<int32_t>(std::lround(static_cast<double>(s.canSizeMg) / fractionDenominator(s.canFraction)));
    }
    return 5000;
}

inline int32_t snapToStep(int32_t mg, int32_t step) {
    if (step <= 0) return mg;
    const int32_t n = static_cast<int32_t>(std::lround(static_cast<double>(mg) / step));
    return std::max(step, n * step);
}

namespace detail {
inline std::string trimZeros(std::string s) {
    if (s.find('.') == std::string::npos) return s;
    while (!s.empty() && s.back() == '0') s.pop_back();
    if (!s.empty() && s.back() == '.') s.pop_back();
    return s;
}
inline std::string fixed(double v, int digits) {
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.*f", digits, v);
    return trimZeros(buf);
}
// Same 0.02 tolerance as shared canParts; glyphs rendered as ASCII fractions.
inline const char* fractionText(double frac) {
    struct { double v; const char* t; } table[] = {{0.25, "1/4"}, {1.0 / 3, "1/3"}, {0.5, "1/2"}, {2.0 / 3, "2/3"}, {0.75, "3/4"}};
    for (auto& e : table) if (std::fabs(frac - e.v) < 0.02) return e.t;
    return nullptr;
}
}  // namespace detail

inline std::string formatAmountAscii(int32_t mg, FoodUnit u, int32_t canSizeMg) {
    const double v = fromMg(mg, u, canSizeMg);
    if (u == FoodUnit::Grams) return std::to_string(static_cast<long>(std::lround(v))) + " g";
    if (u == FoodUnit::Ounces) return detail::fixed(v, 2) + " oz";
    const long whole = static_cast<long>(std::floor(v + 1e-9));
    const double frac = v - static_cast<double>(whole);
    if (frac < 0.02) {
        if (whole == 0) return detail::fixed(v, 2) + " can";
        return std::to_string(whole) + " can";
    }
    const char* f = detail::fractionText(frac);
    if (f == nullptr) return detail::fixed(v, 2) + " can";
    if (whole == 0) return std::string(f) + " can";
    return std::to_string(whole) + " " + f + " can";
}

}  // namespace feedme2::domain
