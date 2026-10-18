#include "application/ScaleOutbox.h"

#include <ArduinoJson.h>
#include <algorithm>
#include <limits>
#include <unordered_set>
#include <utility>

namespace feedme2::application {
namespace {
constexpr uint64_t kMaxSequence = 9007199254740991ULL;
constexpr int64_t kMinUtcMs = 1577836800000LL;  // 2020-01-01; require synced clock
constexpr int64_t kMaxUtcMs = 4102444800000LL;  // server contract, 2100-01-01

const char* kindName(ScaleEventKind kind) {
    switch (kind) {
        case ScaleEventKind::StableWeight: return "stable_weight";
        case ScaleEventKind::BowlRemoved: return "bowl_removed";
        case ScaleEventKind::BowlReturned: return "bowl_returned";
        case ScaleEventKind::SensorFault: return "sensor_fault";
    }
    return "";
}

bool parseKind(const std::string& text, ScaleEventKind& out) {
    if (text == "stable_weight") out = ScaleEventKind::StableWeight;
    else if (text == "bowl_removed") out = ScaleEventKind::BowlRemoved;
    else if (text == "bowl_returned") out = ScaleEventKind::BowlReturned;
    else if (text == "sensor_fault") out = ScaleEventKind::SensorFault;
    else return false;
    return true;
}

bool validFault(const std::string& code) {
    return code == "adc_timeout" || code == "sensor_disconnected" ||
        code == "overload" || code == "calibration_invalid";
}
}

bool ScaleOutbox::validUuid(const std::string& id) {
    if (id.size() != 36) return false;
    for (size_t i = 0; i < id.size(); ++i) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (id[i] != '-') return false;
        } else if (!((id[i] >= '0' && id[i] <= '9') ||
                     (id[i] >= 'a' && id[i] <= 'f'))) return false;
    }
    return true;
}

bool ScaleOutbox::validEvent(const ScaleQueuedEvent& e) {
    if (!validUuid(e.id) || e.sequence == 0 || e.sequence > kMaxSequence ||
        e.observedAt < kMinUtcMs || e.observedAt > kMaxUtcMs ||
        e.calibrationRevision == 0 || e.calibrationRevision > 2147483647u) return false;
    if (e.kind == ScaleEventKind::StableWeight || e.kind == ScaleEventKind::BowlReturned)
        return e.grossMg >= 0 && e.grossMg <= 1000000 && e.faultCode.empty();
    if (e.kind == ScaleEventKind::BowlRemoved)
        return e.grossMg == 0 && e.faultCode.empty();
    return e.kind == ScaleEventKind::SensorFault &&
        e.grossMg == 0 && validFault(e.faultCode);
}

bool ScaleOutbox::parseSequence(const std::string& value, uint64_t& out) {
    if (value.empty()) return false;
    uint64_t parsed = 0;
    for (char ch : value) {
        if (ch < '0' || ch > '9') return false;
        const uint64_t digit = static_cast<uint64_t>(ch - '0');
        if (parsed > (kMaxSequence - digit) / 10) return false;
        parsed = parsed * 10 + digit;
    }
    out = parsed;
    return true;
}

std::string ScaleOutbox::encode(const ScaleQueuedEvent& e) {
    JsonDocument doc;
    doc["id"] = e.id;
    doc["sequence"] = e.sequence;
    doc["observedAt"] = e.observedAt;
    doc["calibrationRevision"] = e.calibrationRevision;
    doc["kind"] = kindName(e.kind);
    if (e.kind == ScaleEventKind::StableWeight || e.kind == ScaleEventKind::BowlReturned)
        doc["grossMg"] = e.grossMg;
    if (e.kind == ScaleEventKind::SensorFault)
        doc["code"] = e.faultCode;
    std::string json;
    serializeJson(doc, json);
    return json;
}

bool ScaleOutbox::decode(const std::string& line, ScaleQueuedEvent& e) {
    JsonDocument doc;
    if (deserializeJson(doc, line) || !doc.is<JsonObject>()) return false;
    JsonObjectConst obj = doc.as<JsonObjectConst>();
    if (!obj["id"].is<const char*>() || !obj["kind"].is<const char*>() ||
        !obj["sequence"].is<uint64_t>() || !obj["observedAt"].is<int64_t>() ||
        !obj["calibrationRevision"].is<uint32_t>()) return false;
    ScaleQueuedEvent candidate;
    candidate.id = obj["id"].as<const char*>();
    candidate.sequence = obj["sequence"].as<uint64_t>();
    candidate.observedAt = obj["observedAt"].as<int64_t>();
    candidate.calibrationRevision = obj["calibrationRevision"].as<uint32_t>();
    if (!parseKind(obj["kind"].as<const char*>(), candidate.kind)) return false;
    const size_t expected = candidate.kind == ScaleEventKind::BowlRemoved ? 5 : 6;
    if (obj.size() != expected) return false;
    if (candidate.kind == ScaleEventKind::StableWeight || candidate.kind == ScaleEventKind::BowlReturned) {
        if (!obj["grossMg"].is<int32_t>()) return false;
        candidate.grossMg = obj["grossMg"].as<int32_t>();
    } else if (candidate.kind == ScaleEventKind::SensorFault) {
        if (!obj["code"].is<const char*>()) return false;
        candidate.faultCode = obj["code"].as<const char*>();
    }
    if (!validEvent(candidate)) return false;
    e = std::move(candidate);
    return true;
}

bool ScaleOutbox::activatePairing(const std::string& epoch) {
    active_ = false;
    items_.clear();
    file_.clear();
    if (!validUuid(epoch)) return false;

    std::string storedEpoch;
    std::string storedSequence;
    const bool hasEpoch = storage_.read(kEpochKey, storedEpoch);
    const bool hasSequence = storage_.read(kSequenceKey, storedSequence);
    // Partial NVS loss is not a new pairing. Never silently reset a live
    // pairing's counter to zero and reuse sequence numbers.
    if (hasEpoch != hasSequence || (hasEpoch && !validUuid(storedEpoch))) return false;
    const bool sameEpoch = hasEpoch && storedEpoch == epoch;
    uint64_t sequence = 0;
    if (sameEpoch) {
        if (!parseSequence(storedSequence, sequence)) return false;
    } else {
        // Write the new epoch first: if power is lost before resetting seq,
        // a stale high sequence creates a gap, never a duplicate.
        if (!storage_.write(kEpochKey, epoch) || !storage_.write(kSequenceKey, "0")) return false;
    }

    const std::string path = "/scale-" + epoch + ".jsonl";
    std::vector<std::string> lines;
    if (!files_.readLines(path.c_str(), lines) || lines.size() > kMaxPending) return false;
    std::vector<ScaleQueuedEvent> decoded;
    decoded.reserve(lines.size());
    uint64_t maxSequence = sequence;
    std::unordered_set<std::string> ids;
    std::unordered_set<uint64_t> sequences;
    for (const auto& line : lines) {
        ScaleQueuedEvent event;
        if (!decode(line, event) || !ids.insert(event.id).second ||
            !sequences.insert(event.sequence).second) return false;
        maxSequence = std::max(maxSequence, event.sequence);
        decoded.push_back(std::move(event));
    }
    // Recover from a torn NVS checkpoint conservatively if the JSONL contains
    // a higher sequence. No data is discarded during recovery.
    if (maxSequence != sequence && !storage_.write(kSequenceKey, std::to_string(maxSequence))) return false;
    file_ = path;
    sequence_ = maxSequence;
    items_ = std::move(decoded);
    active_ = true;
    return true;
}

bool ScaleOutbox::enqueue(ScaleEventKind kind, int64_t observedAt,
                          uint32_t calibrationRevision, int32_t grossMg,
                          const std::string& faultCode) {
    if (!active_ || items_.size() >= kMaxPending || sequence_ >= kMaxSequence) return false;
    ScaleQueuedEvent event;
    event.id = random_.uuid();
    event.sequence = sequence_ + 1;
    event.observedAt = observedAt;
    event.calibrationRevision = calibrationRevision;
    event.kind = kind;
    event.grossMg = grossMg;
    event.faultCode = faultCode;
    if (!validEvent(event)) return false;

    // Persist sequence reservation first; failure means no append and no
    // further writes until a fresh activatePairing reloads the checkpoint.
    if (!storage_.write(kSequenceKey, std::to_string(event.sequence))) {
        active_ = false;
        return false;
    }
    sequence_ = event.sequence;
    if (!files_.appendLine(file_.c_str(), encode(event))) {
        active_ = false;  // partial trailing record needs operator recovery
        return false;
    }
    items_.push_back(std::move(event));
    return true;
}

std::vector<ScaleQueuedEvent> ScaleOutbox::batch(size_t max) const {
    if (!active_) return {};
    const size_t count = std::min(items_.size(), std::min(max, kMaxBatch));
    return {items_.begin(), items_.begin() + count};
}

std::string ScaleOutbox::encodeBatch(const std::vector<ScaleQueuedEvent>& events) const {
    if (events.empty() || events.size() > kMaxBatch) return "";
    std::string json = "[";
    for (size_t i = 0; i < events.size(); ++i) {
        if (!validEvent(events[i])) return "";
        if (i) json += ',';
        json += encode(events[i]);
    }
    return json + "]";
}

bool ScaleOutbox::acknowledge201(int status, const std::string& body,
                                 const std::vector<ScaleQueuedEvent>& sent) {
    if (!active_ || status != 201 || sent.empty() || sent.size() > kMaxBatch ||
        sent.size() > items_.size()) return false;
    for (size_t i = 0; i < sent.size(); ++i)
        if (sent[i].id != items_[i].id || sent[i].sequence != items_[i].sequence) return false;

    JsonDocument doc;
    if (deserializeJson(doc, body) || !doc.is<JsonObject>() ||
        !doc["accepted"].is<JsonArrayConst>() || !doc["now"].is<int64_t>()) return false;
    JsonArrayConst accepted = doc["accepted"].as<JsonArrayConst>();
    std::unordered_set<std::string> expected;
    for (const auto& e : sent) expected.insert(e.id);
    std::unordered_set<std::string> seen;
    for (JsonVariantConst id : accepted) {
        if (!id.is<const char*>() || !expected.count(id.as<const char*>()) ||
            !seen.insert(id.as<const char*>()).second) return false;
    }
    std::vector<std::string> remaining;
    remaining.reserve(items_.size() - sent.size());
    for (size_t i = sent.size(); i < items_.size(); ++i) remaining.push_back(encode(items_[i]));
    if (!files_.rewrite(file_.c_str(), remaining)) return false;
    items_.erase(items_.begin(), items_.begin() + sent.size());
    return true;
}

}  // namespace feedme2::application
