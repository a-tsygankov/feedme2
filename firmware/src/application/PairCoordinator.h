#pragma once
#include <cstdint>
#include <string>
#include "application/LogService.h"
#include "ports/IClock.h"
#include "ports/INetwork.h"
#include "ports/IRandom.h"
#include "ports/IStorage.h"

namespace feedme2::application {

enum class PairPhase : uint8_t { Idle, Starting, Pending, Confirmed, Expired, Failed };

struct PairView {
    PairPhase phase = PairPhase::Idle;
    std::string pairCode;
    int64_t expiresAt = 0;   // server epoch-ms from /pair/start; shown, never used for timing
    std::string error;       // first 60 chars of the rejecting body (Failed only)
};

// Drives the pairing handshake (spec §3.3, §5.2): POST /pair/start, show the 6-digit code,
// poll /pair/check until the person confirms, then keep the token. Every start() draws a fresh
// pollSecret (RAM only, so a reboot mid-pairing starts over) and repeats it on every check:
// /check is public, and without the secret anyone who knows the device id could collect the token.
class PairCoordinator {
public:
    static constexpr uint32_t kDefaultPollMs = 3000;
    static constexpr uint32_t kExpiredRestartMs = 2000;
    static constexpr uint32_t kFailedRetryMs = 5000;
    // The start response carries no server `now`, so its expiresAt cannot be trusted against the
    // device clock; this monotonic cap matches the server's PAIR_TTL_MS and restarts regardless.
    static constexpr uint32_t kPendingMaxMs = 10 * 60 * 1000;
    static constexpr size_t kErrorChars = 60;
    static constexpr const char* kTokenKey = "token";
    static constexpr const char* kNameKey = "name";

    PairCoordinator(ports::INetwork& net, ports::IStorage& storage, ports::IClock& clock, ports::IRandom& random, LogService& log,
                    std::string deviceId, std::string hwModel, std::string fwVersion);

    bool isPaired() const;
    std::string token() const;
    void start();
    void tick(uint32_t nowMs);
    const PairView& view() const { return view_; }
    // Storage erase + network.setToken(""): the Unpair menu and every 401 (the pairing is gone) land here.
    void clearToken();

private:
    void startAt(uint32_t nowMs);
    void poll(uint32_t nowMs);
    void enter(PairPhase phase, uint32_t nowMs);
    void fail(const ports::NetResult& r, uint32_t nowMs);

    ports::INetwork& net_;
    ports::IStorage& storage_;
    ports::IClock& clock_;
    ports::IRandom& random_;
    LogService& log_;
    std::string deviceId_, hwModel_, fwVersion_;
    std::string pollSecret_;
    PairView view_;
    uint32_t pollAfterMs_ = kDefaultPollMs;
    uint32_t phaseSinceMs_ = 0;   // when the current phase was entered (Pending: when start() succeeded)
    uint32_t lastPollMs_ = 0;
};

}  // namespace feedme2::application
