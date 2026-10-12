#include "adapters/EspPower.h"

#include <Arduino.h>
#include <driver/gpio.h>
#include <esp_sleep.h>

namespace feedme2::adapters {

void EspPower::setBacklight(uint8_t percent) {
    if (!pwmAttached_) {
        // Arduino-ESP32 2.x channel API (3.x renamed it to ledcAttach(pin, ...)).
        ledcSetup(kLedcChannel, kLedcFreqHz, kLedcBits);
        ledcAttachPin(kBacklightPin, kLedcChannel);
        pwmAttached_ = true;
    }
    const uint32_t clamped = percent > 100 ? 100 : percent;
    // TFT_BACKLIGHT_ON=HIGH on this board, so duty scales directly with brightness.
    ledcWrite(kLedcChannel, (clamped * 255U) / 100U);
}

void EspPower::displaySleep(bool on) {
    if (on) {
        tft_.writecommand(0x10);  // SLPIN: frame memory is retained, panel stops
        delay(5);
    } else {
        tft_.writecommand(0x11);  // SLPOUT
        delay(120);
    }
}

void EspPower::lightSleep(uint32_t maxMs) {
    // Wake on the knob button (41), the encoder (45) or the touch INT (5).
    // These are ordinary GPIOs, not RTC-domain pins; that is fine for *light*
    // sleep (the digital domain stays powered), unlike the Phase 0 deep-sleep
    // spike which needed an RTC pin. Button and INT are active LOW.
    gpio_wakeup_enable(GPIO_NUM_41, GPIO_INTR_LOW_LEVEL);
    gpio_wakeup_enable(GPIO_NUM_5, GPIO_INTR_LOW_LEVEL);
    // Encoder A rests at whichever level the current detent leaves it. Arming
    // LOW unconditionally would return immediately from every other detent, so
    // arm for a change from the level read now; any turn flips it.
    gpio_wakeup_enable(GPIO_NUM_45, digitalRead(45) == HIGH ? GPIO_INTR_LOW_LEVEL : GPIO_INTR_HIGH_LEVEL);
    esp_sleep_enable_gpio_wakeup();
    esp_sleep_enable_timer_wakeup(static_cast<uint64_t>(maxMs) * 1000ULL);
    // Wi-Fi stays associated in modem sleep; RAM is retained; resume < 100 ms (spec §5.5).
    esp_light_sleep_start();
    // The event that woke us is still on the pins; RotaryInput/Cst816Touch see
    // it on the next poll and PowerManager swallows it (Review Focus 1).
    gpio_wakeup_disable(GPIO_NUM_41);
    gpio_wakeup_disable(GPIO_NUM_45);
    gpio_wakeup_disable(GPIO_NUM_5);
}

}  // namespace feedme2::adapters
