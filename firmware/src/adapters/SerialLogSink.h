#pragma once

#include <Arduino.h>

#include "ports/ILogSink.h"

namespace feedme2::adapters {

// One line per entry on the USB serial console: `[level] msg data`. The
// machine-readable `[feedme2] …` transition lines are emitted by LogService
// through the same sink, so a Wokwi scenario and a person tailing the port
// read the same stream.
class SerialLogSink final : public ports::ILogSink {
public:
    void write(const char* level, const char* msg, const char* dataJsonOrNull) override {
        if (dataJsonOrNull != nullptr && dataJsonOrNull[0] != '\0') {
            Serial.printf("[%s] %s %s\n", level, msg, dataJsonOrNull);
        } else {
            Serial.printf("[%s] %s\n", level, msg);
        }
    }
};

}  // namespace feedme2::adapters
