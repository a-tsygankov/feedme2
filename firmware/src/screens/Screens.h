#pragma once
// The LVGL screens of spec §5.2 as pure renderers of application::App (plan Task 14). main.cpp
// calls render() once per loop: the current screen is rebuilt when app.uiGeneration() changes, the
// long-press arc is updated every frame, and nothing here reads input or prints a serial line
// (the App owns every "[feedme2] …" event).
#include <cstdint>
#include <string>

#include "application/App.h"

namespace feedme2::screens {

// What the About and Wi-Fi screens show that the App does not carry. Hardware main.cpp refreshes it
// from WifiStation; the simulator leaves the defaults.
struct DeviceInfo {
    std::string deviceId;
    bool wifiConnected = false;
    std::string ssid;   // the saved network (and, when connected, the joined one)
    int8_t rssi = 0;    // dBm, 0 when not associated
};

// After lv_init() and the display: creates the top-layer long-press arc.
void begin();
// A changed value re-renders the current screen on the next render().
void setDeviceInfo(const DeviceInfo& info);
void render(application::App& app);
// The raw "Wi-Fi setup / join feedme2-XXXX" page shown before the captive portal takes over the
// chip; the caller flushes it (lv_refr_now) because the portal never returns.
void showPortalSplash(const char* apName);

}  // namespace feedme2::screens
