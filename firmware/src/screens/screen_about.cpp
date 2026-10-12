#include <Arduino.h>

#include <string>

#include "application/Version.h"
#include "screens/Builders.h"

namespace feedme2::screens {

namespace {

constexpr int32_t kLinePitch = 24;

// Non-const: App::sync() has no const overload.
std::string syncLine(application::App& app) {
    const auto& sync = app.sync();
    if (sync.lastRoundOk()) {
        // lastOkAtMs is the clock port's monotonic time; lv_tick is millis(), the same source on
        // hardware (the App exposes no monotonic "now" of its own).
        return "sync ok " + theme::agoText(static_cast<int64_t>(lv_tick_get() - sync.lastOkAtMs()));
    }
    const auto& last = sync.last();
    if (last.unauthorized) return "sync failed: unpaired";
    if (last.ran && !last.stoppedBy.empty()) return "sync failed: " + last.stoppedBy;
    return "not synced yet";
}

}  // namespace

void buildAbout(application::App& app) {
    lv_obj_t* scr = theme::freshScreen();
    theme::label(scr, "About", theme::font14(), theme::kDim, LV_ALIGN_TOP_MID, 0, 22);

    std::string id = deviceInfo().deviceId;
    if (id.empty() && app.hasState()) id = app.state().deviceId;
    const std::string idLine = id.size() >= 6 ? "id ..." + id.substr(id.size() - 6) : "id unknown";
    const std::string house = app.hasState() && !app.state().houseName.empty() ? app.state().houseName : "no house yet";
    const std::string heap = "heap " + std::to_string(ESP.getFreeHeap() / 1024u) + " KB";

    const std::string lines[] = {std::string("fw ") + application::kFirmwareVersion, idLine, house, syncLine(app), heap};
    const int n = static_cast<int>(sizeof lines / sizeof lines[0]);
    const int32_t top = -((n - 1) * kLinePitch) / 2;
    for (int i = 0; i < n; ++i) {
        theme::label(scr, lines[i].c_str(), theme::font14(), i == 2 ? theme::kText : theme::kDim, LV_ALIGN_CENTER, 0,
                     top + i * kLinePitch, 200);
    }
    theme::label(scr, "hold to go back", theme::font12(), theme::kDim, LV_ALIGN_BOTTOM_MID, 0, -24);
}

}  // namespace feedme2::screens
