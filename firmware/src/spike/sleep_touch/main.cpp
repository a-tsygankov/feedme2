// Phase 0 spike: can a touch on the CST816D wake the ESP32-S3 from deep
// sleep, and does the touch controller survive the LCD rail (GPIO 1)
// going low? Build with -DSPIKE_HOLD_LCD_RAIL=0 and =1 (platformio.ini
// [env:spike-sleep]) and record both runs in
// docs/spikes/2026-09-deep-sleep-touch-wake.md.
//
// Sequence per boot:
//   1. print boot count + wake cause (RTC memory survives deep sleep)
//   2. power the LCD, show the boot count
//   3. for 10 s, print the touch INT level once a second — touching the
//      screen while awake should show it pulsing low
//   4. GC9A01 sleep-in, backlight off, optionally hold GPIO 1 high
//   5. arm ext0 wake on GPIO 5 low + a 60 s timer backstop; deep sleep
// A TIMER wake means touch did not wake the chip within a minute.

#include <Arduino.h>
#include <TFT_eSPI.h>
#include <driver/gpio.h>
#include <driver/rtc_io.h>
#include <esp_sleep.h>

#ifndef SPIKE_HOLD_LCD_RAIL
#define SPIKE_HOLD_LCD_RAIL 0
#endif

namespace {
constexpr gpio_num_t kLcdPower = GPIO_NUM_1;
constexpr gpio_num_t kTouchInt = GPIO_NUM_5;
constexpr int kBacklight = TFT_BL;

RTC_DATA_ATTR uint32_t g_bootCount = 0;
TFT_eSPI tft;

const char* causeName(esp_sleep_wakeup_cause_t c) {
    switch (c) {
        case ESP_SLEEP_WAKEUP_EXT0: return "EXT0 (touch)";
        case ESP_SLEEP_WAKEUP_TIMER: return "TIMER (touch did NOT wake)";
        case ESP_SLEEP_WAKEUP_UNDEFINED: return "power-on/reset";
        default: return "other";
    }
}
}  // namespace

void setup() {
    Serial.begin(115200);
    delay(300);
    ++g_bootCount;
    const auto cause = esp_sleep_get_wakeup_cause();
    Serial.printf("[spike] boot #%u cause=%s hold_rail=%d\n",
                  static_cast<unsigned>(g_bootCount), causeName(cause), SPIKE_HOLD_LCD_RAIL);

#if SPIKE_HOLD_LCD_RAIL
    // Release the hold from the previous sleep so we can drive the pin.
    gpio_hold_dis(kLcdPower);
#endif
    pinMode(kLcdPower, OUTPUT);
    digitalWrite(kLcdPower, HIGH);
    delay(50);
    tft.init();
    tft.setRotation(0);
    tft.fillScreen(TFT_BLACK);
    pinMode(kBacklight, OUTPUT);
    digitalWrite(kBacklight, TFT_BACKLIGHT_ON);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.drawString("sleep spike", 120, 90, 4);
    tft.drawString(String("boot ") + g_bootCount, 120, 130, 4);
    tft.drawString(causeName(cause), 120, 165, 2);

    pinMode(kTouchInt, INPUT_PULLUP);
    for (int s = 10; s > 0; --s) {
        Serial.printf("[spike] awake %2d s, touch INT=%d (touch the screen: expect 0 pulses)\n",
                      s, digitalRead(kTouchInt));
        delay(1000);
    }

    // Panel to sleep-in (0x10) so a held rail costs microamps, not mA.
    tft.writecommand(0x10);
    delay(120);
    digitalWrite(kBacklight, TFT_BACKLIGHT_ON == HIGH ? LOW : HIGH);

#if SPIKE_HOLD_LCD_RAIL
    gpio_hold_en(kLcdPower);
    gpio_deep_sleep_hold_en();
    Serial.println("[spike] GPIO1 held HIGH through sleep");
#else
    digitalWrite(kLcdPower, LOW);
    Serial.println("[spike] GPIO1 driven LOW (LCD rail off)");
#endif

    rtc_gpio_pullup_en(kTouchInt);
    rtc_gpio_pulldown_dis(kTouchInt);
    esp_sleep_enable_ext0_wakeup(kTouchInt, 0);
    esp_sleep_enable_timer_wakeup(60ULL * 1000000ULL);
    Serial.println("[spike] deep sleep now — touch the screen within 60 s");
    Serial.flush();
    esp_deep_sleep_start();
}

void loop() {}
