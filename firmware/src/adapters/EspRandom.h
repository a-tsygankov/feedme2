#pragma once

#include <esp_random.h>

#include <string>

#include "ports/IRandom.h"

namespace feedme2::adapters {

// esp_random() is the hardware RNG (true random once the RF subsystem or the
// bootloader's entropy source has run), so it is good enough for the pairing
// pollSecret and for UUID primary keys that must never collide across devices.
class EspRandom final : public ports::IRandom {
public:
    uint32_t next() override { return esp_random(); }

    std::string hex(size_t bytes) override {
        std::string out;
        out.reserve(bytes * 2);
        uint32_t word = 0;
        for (size_t i = 0; i < bytes; ++i) {
            if ((i % 4) == 0) word = esp_random();
            const uint8_t b = static_cast<uint8_t>(word >> ((i % 4) * 8));
            out.push_back(kHex[b >> 4]);
            out.push_back(kHex[b & 0x0F]);
        }
        return out;
    }

    // RFC 4122 v4 layout: xxxxxxxx-xxxx-4xxx-Nxxx-xxxxxxxxxxxx, N in {8,9,a,b}.
    std::string uuid() override {
        const std::string raw = hex(16);
        std::string out;
        out.reserve(36);
        for (size_t i = 0; i < 32; ++i) {
            if (i == 8 || i == 12 || i == 16 || i == 20) out.push_back('-');
            if (i == 12) {
                out.push_back('4');
            } else if (i == 16) {
                out.push_back(kHex[8 + (hexVal(raw[i]) & 0x03)]);
            } else {
                out.push_back(raw[i]);
            }
        }
        return out;
    }

private:
    static constexpr const char* kHex = "0123456789abcdef";
    static uint8_t hexVal(char c) { return c <= '9' ? static_cast<uint8_t>(c - '0') : static_cast<uint8_t>(c - 'a' + 10); }
};

}  // namespace feedme2::adapters
