#include <string>
#include <vector>

#include "screens/Builders.h"

namespace feedme2::screens {

namespace {

constexpr int32_t kRowPitch = 30;
// U+2022 BULLET is in LVGL's built-in Montserrat range (0x20-0x7F, 0xB0, 0x2022); the middle dot
// and the em dash are not.
constexpr const char* kSep = " • ";

std::string rowText(const application::App& app, const application::HistoryEntry& e) {
    std::string s = e.catName;
    if (e.amountKnown) s += kSep + amountText(app, e.amountMg);
    // A stamp before 2020 was logged before the first server `now` (monotonic ms); the server
    // clamps it to its own now, so "just logged" is what the house will see.
    s += kSep + (e.fedAtMs < theme::kEpochSaneMs ? std::string("just logged") : theme::agoText(app.wallNowMs() - e.fedAtMs));
    return s;
}

}  // namespace

// Up to five rows (FeedingService::kRecent): this device's queue first, else the cats' lastFedAt
// from the state. The knob moves the highlight (App::historyOffset); Press dismisses.
void buildHistory(application::App& app) {
    lv_obj_t* scr = theme::freshScreen();
    theme::label(scr, "History", theme::font14(), theme::kDim, LV_ALIGN_TOP_MID, 0, 22);
    const std::vector<application::HistoryEntry> rows = app.historyEntries();
    if (rows.empty()) {
        theme::label(scr, "No feedings yet", theme::font18(), theme::kText, LV_ALIGN_CENTER, 0, 0);
    } else {
        const int n = static_cast<int>(rows.size());
        const int32_t top = -((n - 1) * kRowPitch) / 2;
        for (int i = 0; i < n; ++i) {
            const bool selected = i == app.historyOffset();
            theme::label(scr, rowText(app, rows[static_cast<size_t>(i)]).c_str(), theme::font14(),
                         selected ? theme::kText : theme::kDim, LV_ALIGN_CENTER, 0, top + i * kRowPitch, 200);
        }
    }
    theme::label(scr, "press to close", theme::font12(), theme::kDim, LV_ALIGN_BOTTOM_MID, 0, -24);
}

}  // namespace feedme2::screens
