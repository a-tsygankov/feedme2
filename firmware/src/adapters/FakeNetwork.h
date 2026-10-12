#pragma once

#include <ArduinoJson.h>

#include <cstdint>
#include <string>

#include "ports/IClock.h"
#include "ports/INetwork.h"

namespace feedme2::adapters {

// In-memory stand-in for the device API under -DSIMULATOR=1, so a Wokwi
// scenario runs the whole pair → sync → feed loop with no network and a
// deterministic outcome:
//   pairStart   → {"pairCode":"424242","expiresAt":now+10min,"pollAfterSec":1}, remembers the pollSecret
//   pairCheck   → "unknown" before any start; a different pollSecret → "pending" forever (the server
//                 hands the token only to its holder, and a stranger must learn nothing more than that);
//                 otherwise "pending" twice, then "confirmed" with deviceToken "sim-token"
//   getState    → fixtures/device-state.sample.json (embedded as FakeState.h) with `now` = fixture now +
//                 monotonic clock, ETag W/"sim-<generation>"; 304 when If-None-Match matches
//   postFeedings→ 201 {accepted:[every id],clamped:[...],now}; like the server it moves the cat's
//                 lastFedAt to the latest fedAt and its defaults to that feeding, so the next getState
//                 differs (new ETag) and `[feedme2] sync ok accepted=1 state=changed` is assertable
//   postLogs    → 202, postHeartbeat → 200 {"now":...}
// Every /device call needs the token this fake issued: anything else is 401 {"error":"unauthorized"},
// which is what a real server says to a token from an earlier pairing (jti rotates per pairing).
class FakeNetwork final : public ports::INetwork {
public:
    static constexpr const char* kPairCode = "424242";
    static constexpr const char* kToken = "sim-token";
    static constexpr int kPendingChecks = 2;

    explicit FakeNetwork(ports::IClock& clock);

    bool isOnline() const override { return true; }
    ports::NetResult pairStart(const std::string& deviceId, const std::string& hwModel, const std::string& fw,
                               const std::string& pollSecret) override;
    ports::NetResult pairCheck(const std::string& deviceId, const std::string& pollSecret) override;
    ports::NetResult getState(const std::string& ifNoneMatch) override;
    ports::NetResult postFeedings(const std::string& jsonArray) override;
    ports::NetResult postLogs(const std::string& jsonArray) override;
    ports::NetResult postHeartbeat(const std::string& jsonBody) override;
    void setToken(const std::string& token) override { token_ = token; }

private:
    int64_t nowMs();
    std::string etag() const;
    bool authorized(ports::NetResult& reject) const;

    ports::IClock& clock_;
    JsonDocument state_;       // the fixture, mutated by postFeedings
    int64_t baseNow_ = 0;      // the fixture's `now`; served now = baseNow_ + monotonic ms
    uint32_t generation_ = 1;  // bumped whenever the ETag-covered part of state_ changes
    std::string token_;
    std::string pairingDeviceId_;
    std::string pollSecret_;
    int checks_ = 0;
};

}  // namespace feedme2::adapters
