#include "application/QueueCodec.h"

namespace feedme2::application {

namespace {
void fillDraft(JsonObject o, const domain::FeedingDraft& d) {
    o["id"] = d.id;
    o["catId"] = d.catId;
    o["fedAt"] = d.fedAtMs;
    o["amountMg"] = d.amountMg;
    o["enteredUnit"] = domain::unitLabel(d.unit);
    o["enteredValue"] = d.enteredValue;
}
}  // namespace

std::string encodeDraft(const domain::FeedingDraft& d) {
    JsonDocument doc;
    fillDraft(doc.to<JsonObject>(), d);
    std::string out;
    serializeJson(doc, out);
    return out;
}

bool decodeDraft(const std::string& json, domain::FeedingDraft& out) {
    JsonDocument doc;
    if (deserializeJson(doc, json)) return false;
    if (!doc["id"].is<const char*>() || !doc["catId"].is<const char*>() || !doc["enteredUnit"].is<const char*>() ||
        !doc["enteredValue"].is<const char*>() || !doc["fedAt"].is<int64_t>() || !doc["amountMg"].is<int32_t>())
        return false;
    domain::FeedingDraft d;
    d.id = doc["id"].as<const char*>();
    d.catId = doc["catId"].as<const char*>();
    d.fedAtMs = doc["fedAt"].as<int64_t>();
    d.amountMg = doc["amountMg"].as<int32_t>();
    d.unit = domain::parseUnit(doc["enteredUnit"].as<const char*>());
    d.enteredValue = doc["enteredValue"].as<const char*>();
    out = std::move(d);
    return true;
}

std::string encodeDraftsArray(const std::vector<domain::FeedingDraft>& drafts) {
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    for (const auto& d : drafts) fillDraft(arr.add<JsonObject>(), d);
    std::string out;
    serializeJson(doc, out);
    return out;
}

std::vector<std::string> decodeAcceptedIds(const std::string& responseJson, int64_t* serverNow) {
    std::vector<std::string> ids;
    JsonDocument doc;
    if (deserializeJson(doc, responseJson) || !doc.is<JsonObject>()) return ids;
    if (doc["accepted"].is<JsonArrayConst>())
        for (JsonVariantConst v : doc["accepted"].as<JsonArrayConst>())
            if (v.is<const char*>()) ids.emplace_back(v.as<const char*>());
    if (serverNow && doc["now"].is<int64_t>()) *serverNow = doc["now"].as<int64_t>();
    return ids;
}

std::string encodeLogEntry(int64_t ts, const char* level, const char* msg, const char* dataJson) {
    JsonDocument doc;
    doc["ts"] = ts;
    doc["level"] = level;
    doc["msg"] = msg;
    if (dataJson) {
        JsonDocument data;
        if (!deserializeJson(data, dataJson) && data.is<JsonObject>()) doc["data"] = data;
    }
    std::string out;
    serializeJson(doc, out);
    return out;
}

std::string joinArray(const std::vector<std::string>& jsonObjects) {
    std::string out = "[";
    for (size_t i = 0; i < jsonObjects.size(); ++i) {
        if (i) out += ',';
        out += jsonObjects[i];
    }
    out += ']';
    return out;
}

}  // namespace feedme2::application
