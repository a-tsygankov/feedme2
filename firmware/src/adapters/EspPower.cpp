#include "adapters/EspPower.h"

#include <Arduino.h>
#include <driver/gpio.h>
#include <esp_sleep.h>

#include "adapters/Cst816Touch.h"
#include "adapters/RotaryInput.h"

namespace feedme2::adapters {

namespace {

// Wake pins are the input adapters' own constants so a pin move cannot
// silently leave light sleep deaf to that control.
constexpr gpio_num_t kWakeButton = static_cast<gpio_num_t>(RotaryInput::kPinButton);
constexpr gpio_num_t kWakeEncoderA = static_cast<gpio_num_t>(RotaryInput::kPinA);
constexpr gpio_num_t kWakeTouchInt = static_cast<gpio_num_t>(Cst816Touch::kPinInt);

}  // namespace

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
    // Wake on the knob button, the encoder or the touch INT. These are
    // ordinary GPIOs, not RTC-domain pins; that is fine for *light* sleep (the
    // digital domain stays powered), unlike the Phase 0 deep-sleep spike which
    // needed an RTC pin. Button and INT are active LOW.
    gpio_wakeup_enable(kWakeButton, GPIO_INTR_LOW_LEVEL);
    gpio_wakeup_enable(kWakeTouchInt, GPIO_INTR_LOW_LEVEL);
    // Encoder A rests at whichever level the current detent leaves it. Arming
    // LOW unconditionally would return immediately from every other detent, so
    // arm for a change from the level read now; any turn flips it.
    gpio_wakeup_enable(kWakeEncoderA,
                       digitalRead(RotaryInput::kPinA) == HIGH ? GPIO_INTR_LOW_LEVEL : GPIO_INTR_HIGH_LEVEL);
    esp_sleep_enable_gpio_wakeup();
    esp_sleep_enable_timer_wakeup(static_cast<uint64_t>(maxMs) * 1000ULL);
    // RAM is retained and resume is < 100 ms, but a manual
    // esp_light_sleep_start() does NOT keep the Wi-Fi association: only
    // esp_pm's automatic light sleep coordinates with modem sleep (DTIM
    // listening). The station is dropped here, so the first sync after wake
    // expects a reconnect. With ARDUINO_USB_MODE=1 the USB-CDC console also
    // drops during the sleep (the host sees the device re-enumerate).
    esp_light_sleep_start();
    // The event that woke us is still on the pins; RotaryInput/Cst816Touch see
    // it on the next poll and PowerManager swallows it (Review Focus 1).
    gpio_wakeup_disable(kWakeButton);
    gpio_wakeup_disable(kWakeEncoderA);
    gpio_wakeup_disable(kWakeTouchInt);
}

}  // namespace feedme2::adapters
