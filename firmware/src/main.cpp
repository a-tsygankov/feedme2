// feedme2 firmware entry point (plan Task 14): power the LCD rail, bring up LVGL over TFT_eSPI,
// build the adapters, hand them to application::App and run tick → render from loop(). Nothing
// here prints on its own: every line goes out through SerialLogSink (the App's "[feedme2] …"
// events and, on the simulator, the serial command echo).
//
// -DSIMULATOR=1 (Wokwi): FakeNetwork instead of Wi-Fi, SimulatedClock, input from the serial
// command channel, and a power adapter whose light sleep returns at once so a serial command can
// play the GPIO wake. Hardware: WifiNetwork over WifiStation, knob + touch through CompositeInput,
// EspPower with the real light sleep (wrapped so the station hears about every wake).

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
#include "ports/IPower.h"
#endif

namespace {

using feedme2::application::App;
using feedme2::application::AppDeps;
using feedme2::application::InputEvent;

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

// EspPower whose light sleep tells the station about the wake the moment it returns. The nap runs
// inside App::tick (PowerManager), and a timer wake's sync round goes out later in that same tick:
// a wake noticed from loop() (the old tier-change check) came too late, the round read the stale
// WL_CONNECTED, failed, and the device waited for the 60 s retry. See WifiStation::noteWake.
class StationAwarePower final : public feedme2::ports::IPower {
public:
    StationAwarePower(feedme2::adapters::EspPower& real, feedme2::adapters::WifiStation& station)
        : real_(real), station_(station) {}
    void setBacklight(uint8_t percent) override { real_.setBacklight(percent); }
    void displaySleep(bool on) override { real_.displaySleep(on); }
    void lightSleep(uint32_t maxMs) override {
        real_.lightSleep(maxMs);
        station_.noteWake(millis());
    }
    void ledRing(uint32_t rgb, uint8_t brightness) override { real_.ledRing(rgb, brightness); }

private:
    feedme2::adapters::EspPower& real_;
    feedme2::adapters::WifiStation& station_;
};

StationAwarePower power(espPower, station);
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

// LVGL's own warnings and errors (a decoder that cannot open an image, a failed allocation) go
// through the serial sink like every other line. LV_LOG_LEVEL is WARN, so no per-frame trace
// arrives here; the check is belt and braces. Before this nothing was registered and the cat
// decoder failing on every draw was invisible (review of 944eedc).
void lvglLogCb(lv_log_level_t level, const char* buf) {
    if (level < LV_LOG_LEVEL_WARN) return;
    std::string line(buf ? buf : "");
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    serialSink.write(level >= LV_LOG_LEVEL_ERROR ? "error" : "warn", line.c_str(), nullptr);
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
    lv_log_register_print_cb(lvglLogCb);
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

// Idle is already on the glass from the cached state (spec §5.3); only now does Wi-Fi join, and
// it joins in the background: WiFi.begin() is asynchronous and wifiHousekeeping() probes once a
// second, so the loop (and the knob) keep running during the association.
//
// The portal opens on its own only when there is nothing to join (spec §1.2: "only when it has no
// credentials"), and then only on an unpaired device, which has nothing else to show. With saved
// credentials the device keeps joining however long the network is away: the old rule (unpaired
// and the join failed within 15 s → portal) sent a device whose router was still rebooting after
// a power blip into a portal it never left. Otherwise the portal is a person's request: a Press on
// the Wi-Fi screen (wifiHousekeeping), or, for an unpaired device whose saved network is wrong
// (the Pair screen has no way to the Wi-Fi screen), the knob button held down through boot.
void connectWifi() {
    std::string pass;
    const bool haveCredentials = station.loadCredentials(storage, g_ssid, pass);
    // Active LOW; knob.begin() has already pulled the pin up.
    const bool portalHeld = digitalRead(feedme2::adapters::RotaryInput::kPinButton) == LOW;
    if ((!haveCredentials && !g_app->pair().isPaired()) || portalHeld) runPortal();
    if (haveCredentials) station.connect(g_ssid, pass, /*budgetMs=*/0);
    publishWifiInfo();
}

void wifiHousekeeping(uint32_t now) {
    // Probed once a second in every power tier: loop() only runs while the chip is awake, and a
    // timer wake's sync round runs with the tier still LightSleep (screen off), so skipping the
    // probe there left a join that failed during that round unretried. The rejoin after each nap
    // is StationAwarePower's noteWake; ensureConnected() leaves that join alone for its budget.
    if (now - g_lastWifiProbeMs >= kWifiProbeMs) {
        g_lastWifiProbeMs = now;
        station.ensureConnected();
        publishWifiInfo();
    }
    // The portal only on request: a Press on the Wi-Fi screen (App::takePortalRequest), never from
    // merely opening it (review of 944eedc: an offline device rebooted into the portal on every tick).
    if (g_app->takePortalRequest()) runPortal();
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
    // The App ticks on the IClock, the same source begin() read: under FEEDME2_SIM_SPEED the
    // SimulatedClock runs ahead of millis(), and a tick on millis() would make the two diverge.
    g_app->tick(g_clock.monotonicMs());
#if !SIMULATOR
    wifiHousekeeping(now);
#else
    // No portal on the simulator: the request is logged by the App and dropped here.
    (void)g_app->takePortalRequest();
#endif
    if (now - g_lastHeapMs >= kHeapRefreshMs) {
        g_lastHeapMs = now;
        publishHeartbeatInfo();
    }
    feedme2::screens::render(*g_app);
    lv_timer_handler();
    delay(5);
}
