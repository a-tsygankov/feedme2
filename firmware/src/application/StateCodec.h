#pragma once
#include <cstdint>
#include <string>
#include <ArduinoJson.h>   // not needed by these declarations; the codec tests use JsonDocument through this include
#include "domain/DeviceState.h"

namespace feedme2::application {

// Parses the shared DeviceState JSON (shared/src/device.ts). Unknown keys are ignored so the
// server can add fields without breaking shipped firmware. Required: house.settings, cats, now.
// On failure returns false and sets err to "missing <field>", "invalid <field>" or the parser message.
bool decodeState(const std::string& json, domain::DeviceState& out, std::string& err);

// HeartbeatBodySchema. batteryPct < 0 means "no battery" and the key is omitted.
std::string encodeHeartbeat(const char* fw, uint32_t uptimeSec, const char* resetReason, uint32_t freeHeap, int batteryPct);

}  // namespace feedme2::application
