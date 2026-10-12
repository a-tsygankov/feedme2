#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include <ArduinoJson.h>   // not needed by these declarations; the codec tests use JsonDocument through this include
#include "domain/FeedFlow.h"

namespace feedme2::application {

// One JSON object, no newline, exactly the DeviceFeedingCreate keys (the server schema is strict:
// an extra key is a 400 that would drop the whole batch as Permanent):
// id, catId, fedAt, amountMg, enteredUnit, enteredValue.
std::string encodeDraft(const domain::FeedingDraft& d);
bool decodeDraft(const std::string& json, domain::FeedingDraft& out);
std::string encodeDraftsArray(const std::vector<domain::FeedingDraft>& drafts);

// Reads `accepted` from the feedings response; writes `now` to *serverNow when present (left untouched
// otherwise, and untouched on unparseable input). Returns {} on garbage.
std::vector<std::string> decodeAcceptedIds(const std::string& responseJson, int64_t* serverNow);

// {"ts","level","msg"[, "data"]}. `dataJson` is embedded as a nested object; dropped when null,
// unparseable or not an object (the server wants a record).
std::string encodeLogEntry(int64_t ts, const char* level, const char* msg, const char* dataJson);

// "[" + objects joined by "," + "]"
std::string joinArray(const std::vector<std::string>& jsonObjects);

}  // namespace feedme2::application
