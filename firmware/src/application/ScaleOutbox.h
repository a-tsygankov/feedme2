#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "ports/IFileQueue.h"
#include "ports/IRandom.h"
#include "ports/IStorage.h"

namespace feedme2::application {

// Immutable device observations, never a feeding. The server derives house
// and device identity from the device token, not these JSON fields.
enum class ScaleEventKind : uint8_t { StableWeight, BowlRemoved, BowlReturned, SensorFault };

struct ScaleQueuedEvent {
    std::string id;
    uint64_t sequence = 0;
    int64_t observedAt = 0;
    uint32_t calibrationRevision = 0;
    ScaleEventKind kind = ScaleEventKind::StableWeight;
    int32_t grossMg = 0;
    std::string faultCode;
};

class ScaleOutbox {
public:
    static constexpr const char* kEpochKey = "scale_epoch";
    static constexpr const char* kSequenceKey = "scale_seq";
    static constexpr size_t kMaxPending = 512;
    static constexpr size_t kMaxBatch = 50;

    ScaleOutbox(ports::IFileQueue& files, ports::IStorage& storage, ports::IRandom& random)
        : files_(files), storage_(storage), random_(random) {}

    // Called after every successful pairing. The epoch must be a fresh UUID
    // for every token issue, not a permanent device ID. Old-epoch queue files
    // remain isolated and are NEVER silently re-attributed to a new house.
    bool activatePairing(const std::string& pairingEpoch);
    bool active() const { return active_; }
    size_t pending() const { return items_.size(); }
    const std::string& filePath() const { return file_; }

    // Reserve sequence in NVS BEFORE appending the event to LittleFS.
    // A crash may skip a sequence, but never reuses one within the epoch.
    // observedAt is UTC epoch ms; unsynced clocks must not enqueue.
    bool enqueue(ScaleEventKind kind, int64_t observedAt, uint32_t calibrationRevision,
                 int32_t grossMg = 0, const std::string& faultCode = "");

    std::vector<ScaleQueuedEvent> batch(size_t max = kMaxBatch) const;
    std::string encodeBatch(const std::vector<ScaleQueuedEvent>& events) const;

    // Only HTTP 201 with a valid response acknowledges the WHOLE sent batch.
    // The API's 'accepted' array lists new inserts only, so it may be empty
    // for a replay. A 400, 401, 409, 5xx or network failure NEVER drops data.
    bool acknowledge201(int status, const std::string& responseJson,
                        const std::vector<ScaleQueuedEvent>& sent);

private:
    static bool validUuid(const std::string& id);
    static bool validEvent(const ScaleQueuedEvent& e);
    static std::string encode(const ScaleQueuedEvent& e);
    static bool decode(const std::string& line, ScaleQueuedEvent& e);
    static bool parseSequence(const std::string& value, uint64_t& out);

    ports::IFileQueue& files_;
    ports::IStorage& storage_;
    ports::IRandom& random_;
    std::vector<ScaleQueuedEvent> items_;
    std::string file_;
    uint64_t sequence_ = 0;
    bool active_ = false;
};

}  // namespace feedme2::application
