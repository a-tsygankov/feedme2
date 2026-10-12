#include "application/StateCodec.h"
#include <cstdlib>
#include <cstring>

namespace feedme2::application {

namespace {

bool fail(std::string& err, const char* what) { err = what; return false; }

uint32_t parseColor(const char* s, uint32_t fallback) {
    if (!s || s[0] != '#' || std::strlen(s) != 7) return fallback;
    char* end = nullptr;
    const unsigned long v = std::strtoul(s + 1, &end, 16);
    return (end && *end == '\0') ? static_cast<uint32_t>(v) : fallback;
}

}  // namespace

bool decodeState(const std::string& json, domain::DeviceState& out, std::string& err) {
    JsonDocument doc;
    const DeserializationError e = deserializeJson(doc, json);
    if (e) { err = std::string("json: ") + e.c_str(); return false; }
    if (!doc.is<JsonObject>()) return fail(err, "missing house");

    JsonObjectConst house = doc["house"].as<JsonObjectConst>();
    if (house.isNull()) return fail(err, "missing house");
    JsonObjectConst st = house["settings"].as<JsonObjectConst>();
    if (st.isNull()) return fail(err, "missing house.settings");
    if (!doc["cats"].is<JsonArrayConst>()) return fail(err, "missing cats");
    if (!doc["now"].is<int64_t>()) return fail(err, "missing now");

    domain::DeviceState s;
    s.houseId = house["id"] | "";
    s.houseName = house["name"] | "";
    s.tzOffsetMin = house["tzOffsetMin"] | 0;

    domain::HouseSettings& hs = s.settings;
    hs.foodUnit = domain::parseUnit(st["foodUnit"] | "g");
    hs.canSizeMg = st["canSizeMg"] | domain::kDefaultCanMg;
    hs.canFractionStep = domain::parseFraction(st["canFractionStep"] | "1/4");
    hs.gramStep = st["gramStep"] | 5;
    hs.ozStepHundredths = st["ozStepHundredths"] | 25;
    hs.hungryAfterSecDefault = st["hungryAfterSecDefault"] | 18000;
    hs.sleepTimeoutSec = st["sleepTimeoutSec"] | 300;
    hs.syncIntervalSec = st["syncIntervalSec"] | 21600;
    hs.timezone = st["timezone"] | "UTC";
    // The top-level pair is what the server tells the device to use; it equals the settings today.
    if (doc["sleepTimeoutSec"].is<int32_t>()) hs.sleepTimeoutSec = doc["sleepTimeoutSec"].as<int32_t>();
    if (doc["syncIntervalSec"].is<int32_t>()) hs.syncIntervalSec = doc["syncIntervalSec"].as<int32_t>();

    // A zero or negative interval would divide by zero in Hunger and spin the sync timer.
    if (hs.canSizeMg <= 0) return fail(err, "invalid house.settings.canSizeMg");
    if (hs.gramStep <= 0) return fail(err, "invalid house.settings.gramStep");
    if (hs.ozStepHundredths <= 0) return fail(err, "invalid house.settings.ozStepHundredths");
    if (hs.hungryAfterSecDefault <= 0) return fail(err, "invalid house.settings.hungryAfterSecDefault");
    if (hs.sleepTimeoutSec <= 0) return fail(err, "invalid sleepTimeoutSec");
    if (hs.syncIntervalSec <= 0) return fail(err, "invalid syncIntervalSec");

    JsonObjectConst dev = doc["device"].as<JsonObjectConst>();
    s.deviceId = dev["id"] | "";
    s.deviceName = dev["name"] | "";
    s.nowMs = doc["now"].as<int64_t>();

    for (JsonObjectConst c : doc["cats"].as<JsonArrayConst>()) {
        domain::CatState cat;
        cat.id = c["id"] | "";
        if (cat.id.empty()) return fail(err, "missing cats[].id");
        cat.name = c["name"] | "";
        cat.colorRgb = parseColor(c["color"] | "", cat.colorRgb);
        cat.avatarPose = c["avatarPose"] | "C2";
        cat.hungryAfterSec = c["hungryAfterSec"] | hs.hungryAfterSecDefault;
        if (cat.hungryAfterSec <= 0) return fail(err, "invalid cats[].hungryAfterSec");
        cat.sortOrder = c["sortOrder"] | 0;
        if (c["defaultAmountMg"].is<int32_t>()) {
            cat.hasDefault = true;
            cat.defaultAmountMg = c["defaultAmountMg"].as<int32_t>();
            cat.defaultUnit = domain::parseUnit(c["defaultEnteredUnit"] | "g");
            cat.defaultValue = c["defaultEnteredValue"] | "";
        }
        if (c["lastFedAt"].is<int64_t>()) {
            cat.hasLastFed = true;
            cat.lastFedAtMs = c["lastFedAt"].as<int64_t>();
        }
        s.cats.push_back(std::move(cat));
    }
    s.sortCats();
    out = std::move(s);
    err.clear();
    return true;
}

std::string encodeHeartbeat(const char* fw, uint32_t uptimeSec, const char* resetReason, uint32_t freeHeap, int batteryPct) {
    JsonDocument d;
    d["fwVersion"] = fw;
    d["uptimeSec"] = uptimeSec;
    d["resetReason"] = resetReason;
    d["freeHeap"] = freeHeap;
    if (batteryPct >= 0) d["batteryPct"] = batteryPct;
    std::string out;
    serializeJson(d, out);
    return out;
}

}  // namespace feedme2::application
