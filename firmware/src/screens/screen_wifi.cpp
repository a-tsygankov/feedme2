#include <string>

#include "screens/Builders.h"

namespace feedme2::screens {

namespace {

// Four bars, filled by RSSI: > -60 dBm strong, > -70 good, > -80 weak, else one bar.
void signalBars(lv_obj_t* parent, int8_t rssi, int32_t dy) {
    const int lit = rssi > -60 ? 4 : rssi > -70 ? 3 : rssi > -80 ? 2 : 1;
    for (int i = 0; i < 4; ++i) {
        lv_obj_t* bar = lv_obj_create(parent);
        const int32_t h = 6 + i * 4;
        lv_obj_set_size(bar, 6, h);
        lv_obj_set_style_radius(bar, 1, 0);
        lv_obj_set_style_border_width(bar, 0, 0);
        lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, 0);
        lv_obj_set_style_bg_color(bar, lv_color_hex(i < lit ? theme::kGood : theme::kTrack), 0);
        lv_obj_remove_flag(bar, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_align(bar, LV_ALIGN_CENTER, -15 + i * 10, dy - h / 2 + 9);
    }
}

}  // namespace

// Connection status. There is no "connect to this SSID" path in the App, so this is a status page:
// a network is set up through the captive portal, which hardware main.cpp opens only when the
// person asks for it with a Press here (App::takePortalRequest); opening the screen never does.
void buildWifi(application::App& app) {
    (void)app;
    lv_obj_t* scr = theme::freshScreen();
    theme::label(scr, "Wi-Fi", theme::font14(), theme::kDim, LV_ALIGN_TOP_MID, 0, 22);
    const DeviceInfo& info = deviceInfo();
    if (info.wifiConnected) {
        theme::label(scr, info.ssid.c_str(), theme::font18(), theme::kText, LV_ALIGN_CENTER, 0, -22, 190);
        signalBars(scr, info.rssi, 14);
        const std::string dbm = std::to_string(static_cast<int>(info.rssi)) + " dBm";
        theme::label(scr, dbm.c_str(), theme::font14(), theme::kDim, LV_ALIGN_CENTER, 0, 44);
    } else {
        theme::label(scr, "Not connected", theme::font18(), theme::kText, LV_ALIGN_CENTER, 0, -16);
        const std::string sub = info.ssid.empty() ? "no network saved" : "saved: " + info.ssid;
        theme::label(scr, sub.c_str(), theme::font14(), theme::kDim, LV_ALIGN_CENTER, 0, 16, 190);
    }
#if SIMULATOR
    theme::label(scr, "simulator: fake network", theme::font12(), theme::kDim, LV_ALIGN_BOTTOM_MID, 0, -44);
#else
    theme::label(scr, "press: Wi-Fi setup portal", theme::font12(), theme::kDim, LV_ALIGN_BOTTOM_MID, 0, -44);
#endif
    theme::label(scr, "hold to go back", theme::font12(), theme::kDim, LV_ALIGN_BOTTOM_MID, 0, -24);
}

void showPortalSplash(const char* apName) {
    lv_obj_t* scr = theme::freshScreen();
    theme::label(scr, "Wi-Fi setup", theme::font24(), theme::kText, LV_ALIGN_CENTER, 0, -30);
    const std::string join = std::string("join ") + apName + "\nfrom your phone";
    theme::label(scr, join.c_str(), theme::font14(), theme::kDim, LV_ALIGN_CENTER, 0, 18, 200);
}

}  // namespace feedme2::screens
