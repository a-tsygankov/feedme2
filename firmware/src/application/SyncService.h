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
// requested (wake, feeding, paired, timer, boot) and start from tick() when the network is online
// and the device is paired; the state JSON and ETag are cached in storage so Idle renders before
// Wi-Fi. Every server `now` (feedings, state, heartbeat) corrects the ClockModel.
//
// A round is a step machine: each tick() makes at most ONE request (a feedings batch, a logs
// batch, the state, the heartbeat), so main.cpp renders and reads the knob between them. The
// whole round in one tick blocked the loop for 3–5 s on the S3 (up to 32 s at the 8 s timeouts)
// and froze the Fed screen and the knob (review of the Phase 2b branch). last() and the
// "sync ok" / "sync stopped" lines appear when the round completes or stops.
class SyncService {
public:
    static constexpr const char* kStateKey = "state";
    static constexpr const char* kEtagKey = "etag";
    static constexpr size_t kFeedingBatch = 20;
    static constexpr size_t kLogBatch = 50;
    // A stopped round (transient failure) is retried after this instead of the full
    // syncIntervalSec (6 h by default): a queued feeding would otherwise sit on the device all
    // afternoon after one dropped request. Fixed, not exponential: one 60 s probe is cheap and
    // a server outage that outlasts it is already visible to the household.
    static constexpr uint32_t kRetryAfterMs = 60 * 1000;

    SyncService(ports::INetwork& net, ports::IStorage& storage, ports::IClock& clock, domain::ClockModel& model,
                FeedingService& feedings, LogService& log, PairCoordinator& pair);

    void loadCachedState();
    bool hasState() const { return hasState_; }
    const domain::DeviceState& state() const { return state_; }
    // Flags a round; it starts on the next tick that finds the device online, paired and not
    // already in a round. The first reason wins until that round starts.
    void requestRound(const char* reason);
    bool roundRequested() const { return requested_; }
    // True from the tick that starts a round until the tick that completes or stops it.
    bool roundInProgress() const { return step_ != Step::Idle; }
    void tick(uint32_t nowMs);
    // The last round that completed or stopped (a round in progress is not reflected yet).
    const RoundResult& last() const { return last_; }
    // Increments whenever state_ changes (cached load, a 200 from the server, or forgetState()).
    uint32_t generation() const { return generation_; }
    bool lastRoundOk() const { return lastOk_; }
    uint32_t lastOkAtMs() const { return lastOkAtMs_; }
    void setHeartbeatInfo(HeartbeatInfo info) { heartbeat_ = std::move(info); }
    // Drops the cached house (RAM and NVS, state and ETag): the pairing it belonged to is gone,
    // by a server 401 or the menu Unpair. The next GET is unconditional.
    void forgetState();

private:
    enum class Step : uint8_t { Idle, Feedings, Logs, State, Heartbeat };
    static const char* stepName(Step s);

    void startRound(uint32_t nowMs);
    void advance(uint32_t nowMs);
    void finishRound(uint32_t nowMs);
    // One request each. They return false when the round stopped, true when it goes on (step_
    // moves to the next step once this one is done).
    bool stepFeedings();
    bool stepLogs();
    bool stepState();
    void stepHeartbeat(uint32_t nowMs);
    void enterLogs();
    void applyState(const std::string& json, const std::string& etag, bool persist);
    void syncClock(int64_t serverNowMs);
    void stop(const char* step, const ports::NetResult& res);
    void unauthorized(const char* step);
    // A 401 on a step: the API's revocation unpairs (unauthorized), any other stops the round.
    void refused(const char* step, const ports::NetResult& res);
    // A 401 that is the API's own revocation ({"error":"unauthorized"}, requireDevice): anything
    // else (a captive portal, a proxy, any TLS peer under setInsecure()) is transient.
    static bool revoked(const ports::NetResult& res);

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
    // The round in progress.
    Step step_ = Step::Idle;
    RoundResult cur_;
    size_t feedingPosts_ = 0;   // POSTs left this round (bounded at the round's start)
    size_t logBatches_ = 0;     // logs batches left this round (bounded on entering the step)
};

}  // namespace feedme2::application
