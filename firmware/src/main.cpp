// feedme2 firmware entry point — Phase 0: boot, power the LCD rail,
// bring up LVGL over TFT_eSPI, show the version, print a
// machine-readable boot line. Phase 2 replaces the body with the
// ScreenManager and application services.

#include <Arduino.h>
#include <TFT_eSPI.h>
#include <lvgl.h>

#include <string>

#include "application/Version.h"
#include "domain/SimInput.h"

namespace {

// CrowPanel quirk: GPIO 1 must be driven HIGH to power the LCD's 3.3 V
// rail before TFT_eSPI is initialised. GPIO 2 does the same for the
// LED ring (unused in Phase 0, left low).
constexpr int LCD_POWER_PIN = 1;

TFT_eSPI tft;

// Partial render: 40 lines of 240 px at 16 bpp.
constexpr uint32_t kBufLines = 40;
lv_color_t g_drawBuf[240 * kBufLines];

lv_obj_t* g_status = nullptr;

void flushCb(lv_display_t* disp, const lv_area_t* area, uint8_t* pxMap) {
    const uint32_t w = static_cast<uint32_t>(area->x2 - area->x1 + 1);
    const uint32_t h = static_cast<uint32_t>(area->y2 - area->y1 + 1);
    tft.startWrite();
    tft.setAddrWindow(area->x1, area->y1, w, h);
    tft.pushColors(reinterpret_cast<uint16_t*>(pxMap), w * h, true);
    tft.endWrite();
    lv_display_flush_ready(disp);
}

void buildScreen() {
    lv_obj_t* scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x1a1226), 0);

    lv_obj_t* title = lv_label_create(scr);
    lv_label_set_text_fmt(title, "feedme2\n%s", feedme2::application::kFirmwareVersion);
    lv_obj_set_style_text_color(title, lv_color_hex(0xf6f1e6), 0);
    lv_obj_set_style_text_align(title, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(title, LV_ALIGN_CENTER, 0, -16);

    g_status = lv_label_create(scr);
    lv_label_set_text(g_status, "ready");
    lv_obj_set_style_text_color(g_status, lv_color_hex(0x9c97a4), 0);
    lv_obj_align(g_status, LV_ALIGN_CENTER, 0, 32);
}

#if SIMULATOR
std::string g_line;

// One command per line on Serial → input event. Echoed as
// `[feedme2] input=<Name>` so a Wokwi scenario can assert on it.
void pollSimInput() {
    while (Serial.available() > 0) {
        const char c = static_cast<char>(Serial.read());
        if (c != '\n') {
            if (g_line.size() < 32) g_line.push_back(c);
            continue;
        }
        const auto ev = feedme2::domain::parseSimCommand(g_line);
        g_line.clear();
        const char* name = feedme2::domain::simEventName(ev);
        Serial.printf("[feedme2] input=%s\n", name);
        if (g_status != nullptr) lv_label_set_text(g_status, name);
    }
}
#endif

}  // namespace

void setup() {
    Serial.begin(115200);

    pinMode(LCD_POWER_PIN, OUTPUT);
    digitalWrite(LCD_POWER_PIN, HIGH);
    delay(50);

    tft.init();
    tft.setRotation(0);
    tft.fillScreen(TFT_BLACK);
    pinMode(TFT_BL, OUTPUT);
    digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);

    lv_init();
    lv_tick_set_cb([]() -> uint32_t { return millis(); });
    lv_display_t* disp = lv_display_create(240, 240);
    lv_display_set_flush_cb(disp, flushCb);
    lv_display_set_buffers(disp, g_drawBuf, nullptr, sizeof(g_drawBuf), LV_DISPLAY_RENDER_MODE_PARTIAL);

    buildScreen();
    lv_timer_handler();

    Serial.printf("[feedme2] boot ok fw=%s heap=%u\n",
                  feedme2::application::kFirmwareVersion,
                  static_cast<unsigned>(ESP.getFreeHeap()));
}

void loop() {
    lv_timer_handler();
#if SIMULATOR
    pollSimInput();
#endif
    delay(5);
}
