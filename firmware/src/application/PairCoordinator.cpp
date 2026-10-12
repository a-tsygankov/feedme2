#include "application/PairCoordinator.h"
#include <ArduinoJson.h>
#include <cstring>
#include <utility>

namespace feedme2::application {

PairCoordinator::PairCoordinator(ports::INetwork& net, ports::IStorage& storage, ports::IClock& clock, ports::IRandom& random,
                                 LogService& log, std::string deviceId, std::string hwModel, std::string fwVersion)
    : net_(net), storage_(storage), clock_(clock), random_(random), log_(log),
      deviceId_(std::move(deviceId)), hwModel_(std::move(hwModel)), fwVersion_(std::move(fwVersion)) {}

std::string PairCoordinator::token() const {
    std::string t;
    // IStorage::read is non-const (NVS handles); the coordinator itself does not change.
    if (!const_cast<ports::IStorage&>(storage_).read(kTokenKey, t)) return "";
    return t;
}

bool PairCoordinator::isPaired() const { return !token().empty(); }

void PairCoordinator::enter(PairPhase phase, uint32_t nowMs) {
    view_.phase = phase;
    phaseSinceMs_ = nowMs;
}

void PairCoordinator::fail(const ports::NetResult& r, uint32_t nowMs) {
    view_.error = r.body.substr(0, kErrorChars);
    enter(PairPhase::Failed, nowMs);
    log_.warn("pair failed", ("{\"status\":" + std::to_string(r.status) + "}").c_str());
}

void PairCoordinator::start() { startAt(clock_.monotonicMs()); }

void PairCoordinator::startAt(uint32_t nowMs) {
    // A fresh secret per attempt: the server stores only its hash against the row this start creates,
    // so a secret from an earlier attempt would be answered "pending" forever.
    pollSecret_ = random_.hex(16);
    view_.pairCode.clear();
    view_.expiresAt = 0;
    view_.error.clear();
    enter(PairPhase::Starting, nowMs);

    const ports::NetResult r = net_.pairStart(deviceId_, hwModel_, fwVersion_, pollSecret_);
    if (!r.ok()) { fail(r, nowMs); return; }

    JsonDocument doc;
    if (deserializeJson(doc, r.body) || !doc["pairCode"].is<const char*>()) {
        ports::NetResult bad = r;
        bad.body = "malformed start response";
        fail(bad, nowMs);
        return;
    }
    view_.pairCode = doc["pairCode"].as<const char*>();
    view_.expiresAt = doc["expiresAt"] | int64_t{0};
    const int pollAfterSec = doc["pollAfterSec"] | 0;
    pollAfterMs_ = pollAfterSec > 0 ? static_cast<uint32_t>(pollAfterSec) * 1000u : kDefaultPollMs;
    lastPollMs_ = nowMs;
    enter(PairPhase::Pending, nowMs);
    log_.event("pair start", ("code=" + view_.pairCode).c_str());
}

void PairCoordinator::tick(uint32_t nowMs) {
    switch (view_.phase) {
        case PairPhase::Pending:
            if (nowMs - phaseSinceMs_ >= kPendingMaxMs) { startAt(nowMs); return; }
            if (nowMs - lastPollMs_ >= pollAfterMs_) poll(nowMs);
            return;
        case PairPhase::Expired:
            if (nowMs - phaseSinceMs_ >= kExpiredRestartMs) startAt(nowMs);
            return;
        case PairPhase::Failed:
            if (nowMs - phaseSinceMs_ >= kFailedRetryMs) startAt(nowMs);
            return;
        case PairPhase::Idle:
        case PairPhase::Starting:
        case PairPhase::Confirmed:
            return;
    }
}

void PairCoordinator::poll(uint32_t nowMs) {
    lastPollMs_ = nowMs;
    const ports::NetResult r = net_.pairCheck(deviceId_, pollSecret_);
    using Kind = ports::NetResult::Kind;
    if (r.kind == Kind::Transient || r.kind == Kind::NotModified) return;   // keep the code; try again next poll
    if (!r.ok()) { fail(r, nowMs); return; }                                 // 400 on check: the body is wrong, a new start() is the fix

    JsonDocument doc;
    if (deserializeJson(doc, r.body)) return;
    const char* status = doc["status"] | "";
    if (std::strcmp(status, "pending") == 0) return;
    if (std::strcmp(status, "confirmed") == 0) {
        const std::string tok = doc["deviceToken"] | "";
        if (tok.empty()) return;
        const std::string houseId = doc["houseId"] | "";
        const std::string name = doc["deviceName"] | "";
        storage_.write(kTokenKey, tok);
        storage_.write(kNameKey, name);
        net_.setToken(tok);
        pollSecret_.clear();
        enter(PairPhase::Confirmed, nowMs);
        log_.event("paired", ("house=" + houseId).c_str());
        return;
    }
    // "expired" and "unknown" (the server lost the row) both mean the code on screen is dead:
    // show it for a moment, then draw a new one.
    enter(PairPhase::Expired, nowMs);
}

void PairCoordinator::clearToken() {
    storage_.erase(kTokenKey);
    storage_.erase(kNameKey);
    net_.setToken("");
    pollSecret_.clear();
    view_ = PairView{};
}

}  // namespace feedme2::application
