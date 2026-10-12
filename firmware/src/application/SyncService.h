#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>
#include "application/FeedingService.h"
#include "application/LogService.h"
#include "application/PairCoordinator.h"
#include "domain/Clock.h"
#include "domain/DeviceState.h"
#include "ports/IClock.h"
#include "ports/INetwork.h"
#include "ports/IStorage.h"

namespace feedme2::application {

// What the heartbeat reports about the running firmware. App fills it (fw from AppDeps, reset
// reason and free heap from the ESP adapters); the defaults keep a bare SyncService valid.
struct HeartbeatInfo {
    std::string fw = "0.0.0";
    std::string resetReason = "unknown";
    uint32_t freeHeap = 0;
    int batteryPct = -1;   // -1 = no battery: the key is omitted
};

struct RoundResult {
    bool ran = false;
    int feedingsSent = 0;        // drafts POSTed this round, re-sends after a partial drop included
    // Ids that left the queue because the server now holds them (accepted, already there, or
    // known-conflicting): the N in "[feedme2] sync ok accepted=N".
    int feedingsAccepted = 0;
    int logsSent = 0;
    bool stateChanged = false;
    bool heartbeatOk = false;
    bool unauthorized = false;   // a 401 on any call: the token is cleared, App returns to Pair
    std::string stoppedBy;       // "" when the round completed; else feedings | logs | state | heartbeat
    std::string reason;          // the request reason that started the round
};

// One sync round (spec §5.3): feedings → logs → state (If-None-Match) → heartbeat. Rounds are
// requested (wake, feeding, paired, timer, boot) and run from tick() when the network is online
// and the device is paired; the state JSON and ETag are cached in storage so Idle renders before
// Wi-Fi. Every server `now` (feedings, state, heartbeat) corrects the ClockModel.
class SyncService {
public:
    static constexpr const char* kStateKey = "state";
    static constexpr const char* kEtagKey = "etag";
    static constexpr size_t kFeedingBatch = 20;
    static constexpr size_t kLogBatch = 50;

    SyncService(ports::INetwork& net, ports::IStorage& storage, ports::IClock& clock, domain::ClockModel& model,
                FeedingService& feedings, LogService& log, PairCoordinator& pair);

    void loadCachedState();
    bool hasState() const { return hasState_; }
    const domain::DeviceState& state() const { return state_; }
    // Flags a round; it runs on the next tick that finds the device online and paired. The first
    // reason wins until that round runs.
    void requestRound(const char* reason);
    bool roundRequested() const { return requested_; }
    void tick(uint32_t nowMs);
    const RoundResult& last() const { return last_; }
    // Increments whenever state_ changes (cached load or a 200 from the server).
    uint32_t generation() const { return generation_; }
    bool lastRoundOk() const { return lastOk_; }
    uint32_t lastOkAtMs() const { return lastOkAtMs_; }
    void setHeartbeatInfo(HeartbeatInfo info) { heartbeat_ = std::move(info); }

private:
    void runRound(uint32_t nowMs);
    bool syncFeedings(RoundResult& r);
    bool syncLogs(RoundResult& r);
    bool syncState(RoundResult& r);
    void syncHeartbeat(RoundResult& r, uint32_t nowMs);
    void applyState(const std::string& json, const std::string& etag, bool persist);
    void syncClock(int64_t serverNowMs);
    void stop(RoundResult& r, const char* step, const ports::NetResult& res);
    void unauthorized(RoundResult& r, const char* step);

    ports::INetwork& net_;
    ports::IStorage& storage_;
    ports::IClock& clock_;
    domain::ClockModel& model_;
    FeedingService& feedings_;
    LogService& log_;
    PairCoordinator& pair_;
    HeartbeatInfo heartbeat_;
    domain::DeviceState state_;
    bool hasState_ = false;
    std::string etag_;
    uint32_t generation_ = 0;
    bool requested_ = false;
    std::string reason_;
    RoundResult last_;
    bool lastOk_ = false;
    uint32_t lastOkAtMs_ = 0;
    uint32_t lastRoundAtMs_ = 0;
};

}  // namespace feedme2::application
