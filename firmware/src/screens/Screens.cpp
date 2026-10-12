#include "screens/Screens.h"

#include <lvgl.h>

#include "domain/Router.h"
#include "domain/Units.h"
#include "screens/Builders.h"
#include "screens/components/LongPressArcWidget.h"

namespace feedme2::screens {

namespace {

// "fed 2 h ago" and the History rows age without any App change, so those two screens are
// rebuilt on a timer as well as on uiGeneration.
constexpr uint32_t kAgoRefreshMs = 30'000;

DeviceInfo g_info;
uint32_t g_infoGeneration = 0;
uint32_t g_seenUi = 0xFFFFFFFFu;
uint32_t g_seenInfo = 0xFFFFFFFFu;
uint32_t g_builtAtMs = 0;
LongPressArcWidget g_arc;

void build(application::App& app) {
    using domain::ScreenId;
    switch (app.router().current()) {
        case ScreenId::Boot: buildBoot(app); return;
        case ScreenId::Pair: buildPair(app); return;
        case ScreenId::Idle: buildIdle(app); return;
        case ScreenId::Amount: buildAmount(app); return;
        case ScreenId::Fed: buildFed(app); return;
        case ScreenId::History: buildHistory(app); return;
        case ScreenId::System: buildSystem(app); return;
        case ScreenId::WifiList: buildWifi(app); return;
        case ScreenId::About: buildAbout(app); return;
        case ScreenId::UnpairConfirm: buildUnpair(app); return;
    }
}

bool agesOnScreen(domain::ScreenId s) { return s == domain::ScreenId::Idle || s == domain::ScreenId::History; }

}  // namespace

const DeviceInfo& deviceInfo() { return g_info; }

std::string amountText(const application::App& app, int32_t mg) {
    if (!app.hasState()) return domain::formatAmountAscii(mg, domain::FoodUnit::Grams, domain::kDefaultCanMg);
    const auto& s = app.state().settings;
    return domain::formatAmountAscii(mg, s.foodUnit, s.canSizeMg);
}

void begin() { g_arc.create(); }

void setDeviceInfo(const DeviceInfo& info) {
    if (info.deviceId == g_info.deviceId && info.wifiConnected == g_info.wifiConnected && info.ssid == g_info.ssid &&
        info.rssi == g_info.rssi) {
        return;
    }
    g_info = info;
    ++g_infoGeneration;
}

void render(application::App& app) {
    // lv_tick is millis(): the same monotonic source as the hardware clock port, and only the
    // simulator's speed factor apart from it, which a 30 s label refresh does not mind.
    const uint32_t now = lv_tick_get();
    const bool changed = app.uiGeneration() != g_seenUi || g_infoGeneration != g_seenInfo;
    const bool aged = agesOnScreen(app.router().current()) && now - g_builtAtMs >= kAgoRefreshMs;
    if (changed || aged) {
        g_seenUi = app.uiGeneration();
        g_seenInfo = g_infoGeneration;
        g_builtAtMs = now;
        build(app);
    }
    g_arc.update(app.arc());
}

}  // namespace feedme2::screens
