// feedme2 firmware entry point (plan Task 14): power the LCD rail, bring up LVGL over TFT_eSPI,
// build the adapters, hand them to application::App and run tick → render from loop(). Nothing
// here prints on its own: every line goes out through SerialLogSink (the App's "[feedme2] …"
// events and, on the simulator, the serial command echo).
//
// -DSIMULATOR=1 (Wokwi): FakeNetwork instead of Wi-Fi, SimulatedClock, input from the serial
// command channel, and a power adapter whose light sleep returns at once so a serial command can
// play the GPIO wake. Hardware: WifiNetwork over WifiStation, knob + touch through CompositeInput,
// EspPower with the real light sleep.

#include <Arduino.h>
#include <TFT_eSPI.h>
#include <esp_mac.h>
#include <esp_system.h>
#include <lvgl.h>

#include <cstdio>
#include <deque>
#include <string>

#include "adapters/EspPower.h"
#include "adapters/EspRandom.h"
#include "adapters/LittleFsQueue.h"
#include "adapters/NvsStorage.h"
#include "adapters/SerialLogSink.h"
#include "application/App.h"
#include "application/SyncService.h"
#include "application/Version.h"
#include "domain/Router.h"
#include "screens/Screens.h"
#if SIMULATOR
#include "adapters/FakeNetwork.h"
#include "adapters/SimulatedClock.h"
#include "domain/SimInput.h"
#include "ports/IInput.h"
#include "ports/IPower.h"
#else
#include "adapters/ArduinoClock.h"
#include "adapters/CompositeInput.h"
#include "adapters/Cst816Touch.h"
#include "adapters/RotaryInput.h"
#include "adapters/WifiCaptivePortal.h"
#include "adapters/WifiNetwork.h"
#include "adapters/WifiStation.h"
#endif

namespace {

using feedme2::application::App;
using feedme2::application::AppDeps;
using feedme2::application::InputEvent;
using feedme2::application::PowerTier;

// CrowPanel quirk: GPIO 1 must be driven HIGH to power the LCD's 3.3 V rail before TFT_eSPI is
// initialised. GPIO 2 (the LED rail) is raised by LedRing on first use.
constexpr int kLcdPowerPin = 1;

// Partial render: 40 lines of 240 px at 16 bpp. Bytes, not lv_color_t: in LVGL 9 lv_color_t is
// always the 3-byte RGB888 struct, so sizing a 16-bpp buffer with it wastes half again as much RAM
// and silently changes the line count LVGL derives from sizeof().
constexpr uint32_t kBufLines = 40;
alignas(4) uint8_t g_drawBuf[240 * kBufLines * 2];

constexpr uint32_t kWifiProbeMs = 1000;
constexpr uint32_t kHeapRefreshMs = 10'000;

TFT_eSPI tft;
feedme2::adapters::NvsStorage storage;
feedme2::adapters::LittleFsQueue files;
feedme2::adapters::EspRandom rnd;
feedme2::adapters::SerialLogSink serialSink;
feedme2::adapters::EspPower espPower(tft);

#if SIMULATOR

feedme2::adapters::SimulatedClock g_clock;
feedme2::adapters::FakeNetwork network(g_clock);

// The serial command channel (spec §5.7): one of press | double | long | cw | ccw | touch per line
// becomes the InputEvent a knob or a tap would have produced (touch = Press, spec §5.2). Each
// line is echoed as "[feedme2] input=<Name>" through the log sink so a scenario can assert it.
// Nothing is ever "held": the long-press arc stays hidden in the simulator.
class SimInput final : public feedme2::ports::IInput {
public:
    explicit SimInput(feedme2::ports::ILogSink& sink) : sink_(sink) {}

    void pump() {
        while (Serial.available() > 0) {
            const char c = static_cast<char>(Serial.read());
            if (c != '\n') {
                if (line_.size() < 32) line_.push_back(c);
                continue;
            }
            const auto ev = feedme2::domain::parseSimCommand(line_);
            line_.clear();
            sink_.write("info", (std::string("[feedme2] input=") + feedme2::domain::simEventName(ev)).c_str(), nullptr);
            const InputEvent mapped = map(ev);
            if (mapped != InputEvent::None) queue_.push_back(mapped);
        }
    }

    InputEvent poll() override {
        if (queue_.empty()) return InputEvent::None;
        const InputEvent e = queue_.front();
        queue_.pop_front();
        return e;
    }

    bool isHeld() const override { return false; }

private:
    static InputEvent map(feedme2::domain::SimEvent ev) {
        using feedme2::domain::SimEvent;
        switch (ev) {
            case SimEvent::Press: case SimEvent::Touch: return InputEvent::Press;
            case SimEvent::DoubleTap: return InputEvent::DoubleTap;
            case SimEvent::LongPress: return InputEvent::LongPress;
            case SimEvent::RotateCW: return InputEvent::RotateCW;
            case SimEvent::RotateCCW: return InputEvent::RotateCCW;
            case SimEvent::None: break;
        }
        return InputEvent::None;
    }

    feedme2::ports::ILogSink& sink_;
    std::string line_;
    std::deque<InputEvent> queue_;
};

// Wokwi has no knob to wake a real esp_light_sleep_start(), and a scenario that idles past the
// sleep threshold would hang until the timer wake. Sleeping here is a short delay so loop() keeps
// pumping the serial channel; the next command is the wake event PowerManager swallows.
class SimPower final : public feedme2::ports::IPower {
public:
    explicit SimPower(feedme2::ports::IPower& real) : real_(real) {}
    void setBacklight(uint8_t percent) override { real_.setBacklight(percent); }
    void displaySleep(bool on) override { real_.displaySleep(on); }
    void lightSleep(uint32_t maxMs) override { (void)maxMs; delay(10); }
    void ledRing(uint32_t rgb, uint8_t brightness) override { real_.ledRing(rgb, brightness); }

private:
    feedme2::ports::IPower& real_;
};

SimInput input(serialSink);
SimPower power(espPower);
constexpr const char* kHwModel = "simulator";

#else

feedme2::adapters::ArduinoClock g_clock;
feedme2::adapters::WifiNetwork network(feedme2::adapters::WifiNetwork::kDefaultBaseUrl);
feedme2::adapters::WifiStation station;
feedme2::adapters::RotaryInput knob;
feedme2::adapters::Cst816Touch touch;
feedme2::adapters::CompositeInput<feedme2::adapters::RotaryInput, feedme2::adapters::Cst816Touch> input(knob, touch);
feedme2::adapters::EspPower& power = espPower;
constexpr const char* kHwModel = "crowpanel-1.28";
std::string g_ssid;   // the saved network, for the Wi-Fi screen
uint32_t g_lastWifiProbeMs = 0;

#endif

App* g_app = nullptr;
std::string g_deviceId;
uint32_t g_lastHeapMs = 0;

// 32 lowercase hex: 20 zeros + the 12 hex chars of the station MAC (howler's deviceIdFromMac).
std::string deviceIdFromMac() {
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char buf[33];
    std::snprintf(buf, sizeof buf, "00000000000000000000%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return buf;
}

const char* resetReasonName() {
    switch (esp_reset_reason()) {
        case ESP_RST_POWERON: return "power_on";
        case ESP_RST_EXT: return "external";
        case ESP_RST_SW: return "software";
        case ESP_RST_PANIC: return "panic";
        case ESP_RST_INT_WDT: return "int_watchdog";
        case ESP_RST_TASK_WDT: return "task_watchdog";
        case ESP_RST_WDT: return "watchdog";
        case ESP_RST_DEEPSLEEP: return "deep_sleep";
        case ESP_RST_BROWNOUT: return "brownout";
        case ESP_RST_SDIO: return "sdio";
        case ESP_RST_UNKNOWN: break;
    }
    return "unknown";
}

void publishHeartbeatInfo() {
    feedme2::application::HeartbeatInfo info;
    info.fw = feedme2::application::kFirmwareVersion;
    info.resetReason = resetReasonName();
    info.freeHeap = ESP.getFreeHeap();
    g_app->sync().setHeartbeatInfo(info);
}

void flushCb(lv_display_t* disp, const lv_area_t* area, uint8_t* pxMap) {
    const uint32_t w = static_cast<uint32_t>(area->x2 - area->x1 + 1);
    const uint32_t h = static_cast<uint32_t>(area->y2 - area->y1 + 1);
    tft.startWrite();
    tft.setAddrWindow(area->x1, area->y1, w, h);
    tft.pushColors(reinterpret_cast<uint16_t*>(pxMap), w * h, true);
    tft.endWrite();
    lv_display_flush_ready(disp);
}

void initDisplay() {
    pinMode(kLcdPowerPin, OUTPUT);
    digitalWrite(kLcdPowerPin, HIGH);
    delay(50);

    tft.init();
    tft.setRotation(0);
    tft.fillScreen(TFT_BLACK);
    power.setBacklight(feedme2::application::PowerManager::kAwakeBacklight);

    lv_init();
    lv_tick_set_cb([]() -> uint32_t { return millis(); });
    lv_display_t* disp = lv_display_create(240, 240);
    lv_display_set_flush_cb(disp, flushCb);
    lv_display_set_buffers(disp, g_drawBuf, nullptr, sizeof(g_drawBuf), LV_DISPLAY_RENDER_MODE_PARTIAL);
}

// One frame on the glass now, not at the next lv_timer_handler() period.
void renderNow() {
    feedme2::screens::render(*g_app);
    lv_refr_now(nullptr);
}

#if !SIMULATOR

void publishWifiInfo() {
    feedme2::screens::DeviceInfo info;
    info.deviceId = g_deviceId;
    info.wifiConnected = station.isConnected();
    info.ssid = g_ssid;
    // Only the Wi-Fi screen shows the RSSI: a value that drifts by a dB every second would
    // otherwise rebuild whatever screen is up (Idle re-inflates its PNG on every rebuild).
    if (g_app->router().current() == feedme2::domain::ScreenId::WifiList) info.rssi = station.rssi();
    feedme2::screens::setDeviceInfo(info);
}

[[noreturn]] void runPortal() {
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char apName[20];
    std::snprintf(apName, sizeof apName, "feedme2-%02x%02x", mac[4], mac[5]);   // WifiCaptivePortal's SoftAP name
    feedme2::screens::showPortalSplash(apName);
    lv_refr_now(nullptr);
    feedme2::adapters::WifiCaptivePortal portal;
    portal.runAndReboot(storage);
}

// Idle is already on the glass from the cached state (spec §5.3); only now does Wi-Fi join, with
// WifiStation's budget. Without credentials, or when the join fails, an unpaired device has
// nothing to show and goes straight to the setup portal; a paired one keeps serving the cache and
// ensureConnected() retries from loop(). The Wi-Fi menu entry opens the portal on demand.
void connectWifi() {
    std::string pass;
    const bool haveCredentials = station.loadCredentials(storage, g_ssid, pass);
    const bool joined = haveCredentials && station.connect(g_ssid, pass, feedme2::adapters::WifiStation::kDefaultBudgetMs);
    if (!joined && !g_app->pair().isPaired()) runPortal();
    publishWifiInfo();
    // The join blocked loop() for up to the budget: without this the idle timer counts from
    // power-on and the screen dims the moment the device becomes usable.
    g_app->power().noteInput(millis());
}

void wifiHousekeeping(uint32_t now, PowerTier before) {
    const PowerTier after = g_app->power().tier();
    if (after == PowerTier::LightSleep) return;
    // A manual light sleep drops the association (EspPower::lightSleep): re-kick it on the wake,
    // then keep probing once a second so a failed boot join is retried too.
    if (before == PowerTier::LightSleep || now - g_lastWifiProbeMs >= kWifiProbeMs) {
        g_lastWifiProbeMs = now;
        station.ensureConnected();
        publishWifiInfo();
    }
    // "The menu asks": entering the Wi-Fi screen while offline is the request to set Wi-Fi up.
    if (g_app->router().current() == feedme2::domain::ScreenId::WifiList && !station.isConnected()) runPortal();
}

#endif

}  // namespace

void setup() {
    Serial.begin(115200);
    initDisplay();
#if !SIMULATOR
    knob.begin();
    touch.begin();
#endif
    g_deviceId = deviceIdFromMac();

    static App theApp(AppDeps{g_clock, rnd, input, network, storage, files, power, serialSink, g_deviceId, kHwModel,
                              feedme2::application::kFirmwareVersion});
    g_app = &theApp;
    publishHeartbeatInfo();
    feedme2::screens::begin();
    feedme2::screens::DeviceInfo info;
    info.deviceId = g_deviceId;
    feedme2::screens::setDeviceInfo(info);

    // Prints "[feedme2] boot ok …" and then "screen=idle|pair" (the cached state renders first).
    theApp.begin();
    renderNow();
#if !SIMULATOR
    connectWifi();
#endif
}

void loop() {
    const uint32_t now = millis();
#if SIMULATOR
    input.pump();
#endif
    const PowerTier before = g_app->power().tier();
    g_app->tick(now);
#if !SIMULATOR
    wifiHousekeeping(now, before);
#else
    (void)before;
#endif
    if (now - g_lastHeapMs >= kHeapRefreshMs) {
        g_lastHeapMs = now;
        publishHeartbeatInfo();
    }
    feedme2::screens::render(*g_app);
    lv_timer_handler();
    delay(5);
}
