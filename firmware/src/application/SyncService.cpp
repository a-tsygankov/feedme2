#include "application/SyncService.h"
#include <ArduinoJson.h>
#include <algorithm>
#include <utility>
#include "application/QueueCodec.h"
#include "application/StateCodec.h"

namespace feedme2::application {

namespace {
using Kind = ports::NetResult::Kind;

std::string statusJson(int status, const char* extraKey = nullptr, const std::string& extra = "") {
    std::string s = "{\"status\":" + std::to_string(status);
    if (extraKey) s += std::string(",\"") + extraKey + "\":\"" + extra + "\"";
    return s + "}";
}

// The `error` code and one string array of a rejecting body ({"error":"cat_not_found","catIds":[…]}
// or {"error":"id_conflict","ids":[…]}). Garbage yields an empty code.
std::string rejection(const std::string& body, const char* listKey, std::vector<std::string>& list) {
    JsonDocument doc;
    if (deserializeJson(doc, body) || !doc.is<JsonObject>()) return "";
    if (doc[listKey].is<JsonArrayConst>())
        for (JsonVariantConst v : doc[listKey].as<JsonArrayConst>())
            if (v.is<const char*>()) list.emplace_back(v.as<const char*>());
    return doc["error"] | "";
}

int64_t serverNowOf(const std::string& body) {
    JsonDocument doc;
    if (deserializeJson(doc, body) || !doc["now"].is<int64_t>()) return 0;
    return doc["now"].as<int64_t>();
}
}  // namespace

SyncService::SyncService(ports::INetwork& net, ports::IStorage& storage, ports::IClock& clock, domain::ClockModel& model,
                         FeedingService& feedings, LogService& log, PairCoordinator& pair)
    : net_(net), storage_(storage), clock_(clock), model_(model), feedings_(feedings), log_(log), pair_(pair) {}

void SyncService::loadCachedState() {
    std::string json, etag;
    if (!storage_.read(kStateKey, json)) return;
    storage_.read(kEtagKey, etag);
    domain::DeviceState s;
    std::string err;
    if (!decodeState(json, s, err)) {
        // Without a usable state the ETag must go too: a 304 against it would leave the device blank.
        log_.warn("cached state unreadable", ("{\"err\":\"" + err + "\"}").c_str());
        storage_.erase(kStateKey);
        storage_.erase(kEtagKey);
        return;
    }
    state_ = std::move(s);
    hasState_ = true;
    etag_ = etag;
    ++generation_;
    // The snapshot's `now` is when it was fetched, not now: the clock stays unsynced until a server answers.
}

void SyncService::requestRound(const char* reason) {
    if (!requested_) reason_ = reason ? reason : "";
    requested_ = true;
}

void SyncService::tick(uint32_t nowMs) {
    if (hasState_ && state_.settings.syncIntervalSec > 0) {
        const uint32_t interval = static_cast<uint32_t>(state_.settings.syncIntervalSec) * 1000u;
        if (nowMs - lastRoundAtMs_ >= interval) requestRound("timer");
    }
    if (!requested_ || !net_.isOnline() || !pair_.isPaired()) return;
    requested_ = false;
    runRound(nowMs);
}

void SyncService::runRound(uint32_t nowMs) {
    lastRoundAtMs_ = nowMs;
    RoundResult r;
    r.ran = true;
    r.reason = reason_;
    log_.event("sync start", ("reason=" + reason_).c_str());
    if (syncFeedings(r) && syncLogs(r) && syncState(r)) syncHeartbeat(r, nowMs);
    lastOk_ = r.stoppedBy.empty();
    if (lastOk_) {
        lastOkAtMs_ = nowMs;
        log_.event("sync ok", ("accepted=" + std::to_string(r.feedingsAccepted) + " state=" + (r.stateChanged ? "changed" : "same")).c_str());
    }
    last_ = std::move(r);
}

void SyncService::stop(RoundResult& r, const char* step, const ports::NetResult& res) {
    r.stoppedBy = step;
    log_.event("sync stopped", ("at=" + std::string(step) + " status=" + std::to_string(res.status)).c_str());
}

void SyncService::unauthorized(RoundResult& r, const char* step) {
    // Tokens are per pairing: a 401 means this one was revoked (forget or re-pair), so retrying
    // can only 401 again. Clear it and let App route to Pair (Review Focus 3).
    pair_.clearToken();
    r.unauthorized = true;
    log_.warn("device unpaired by server", statusJson(401, "at", step).c_str());
    r.stoppedBy = step;
    log_.event("sync stopped", ("at=" + std::string(step) + " status=401").c_str());
}

void SyncService::syncClock(int64_t serverNowMs) {
    if (serverNowMs > 0) model_.syncFromServer(serverNowMs, clock_.monotonicMs());
}

bool SyncService::syncFeedings(RoundResult& r) {
    while (!feedings_.queue().empty()) {
        const auto batch = feedings_.headBatch(kFeedingBatch);
        std::vector<std::string> sentIds;
        for (const auto& d : batch) sentIds.push_back(d.id);
        r.feedingsSent += static_cast<int>(batch.size());
        const ports::NetResult res = net_.postFeedings(encodeDraftsArray(batch));
        switch (res.kind) {
            case Kind::Ok: {
                int64_t now = 0;
                const auto accepted = decodeAcceptedIds(res.body, &now);
                // A 201 settles every id sent: one missing from `accepted` is a duplicate the server
                // already holds (a retry after a lost response; ON CONFLICT DO NOTHING), never a rejection —
                // foreign ids are a 409 and unknown cats a 404 before anything is written.
                if (accepted.size() < sentIds.size())
                    log_.warn("feedings already on server", ("{\"n\":" + std::to_string(sentIds.size() - accepted.size()) + "}").c_str());
                feedings_.markAccepted(sentIds);
                r.feedingsAccepted += static_cast<int>(sentIds.size());
                syncClock(now);
                break;
            }
            case Kind::Unauthorized:
                unauthorized(r, "feedings");
                return false;
            case Kind::Transient:
            case Kind::NotModified:
                stop(r, "feedings", res);
                return false;
            case Kind::Permanent: {
                // Retrying the same body cannot help, so something must leave the queue or the device
                // would post this batch every round forever.
                std::vector<std::string> listed;
                const std::string code = rejection(res.body, res.status == 404 ? "catIds" : "ids", listed);
                std::vector<std::string> drop;
                if (code == "cat_not_found") {
                    // The cat was deleted on the web; its feedings have nowhere to go. The rest stay.
                    for (const auto& d : batch)
                        if (std::find(listed.begin(), listed.end(), d.catId) != listed.end()) drop.push_back(d.id);
                    if (!drop.empty()) {
                        log_.warn("feedings dropped: cat not found", ("{\"n\":" + std::to_string(drop.size()) + "}").c_str());
                    }
                } else if (code == "id_conflict") {
                    // The id exists under another house; the server will never take it, so it is "done".
                    for (const auto& id : sentIds)
                        if (std::find(listed.begin(), listed.end(), id) != listed.end()) drop.push_back(id);
                    if (!drop.empty()) {
                        log_.warn("feedings dropped: id conflict", ("{\"n\":" + std::to_string(drop.size()) + "}").c_str());
                        r.feedingsAccepted += static_cast<int>(drop.size());
                    }
                }
                if (drop.empty()) {
                    // 400 (or a rejection naming nothing in the batch): the whole batch is poisoned.
                    drop = sentIds;
                    log_.error("feedings rejected", statusJson(res.status, "error", code).c_str());
                }
                feedings_.markAccepted(drop);
                break;
            }
        }
    }
    return true;
}

bool SyncService::syncLogs(RoundResult& r) {
    // Bounded up front: a warn logged below adds a pending line, and an unbounded drain of a
    // server that 400s everything would never end.
    size_t batches = (log_.pending() + kLogBatch - 1) / kLogBatch;
    while (batches-- > 0 && log_.pending() > 0) {
        auto batch = log_.takeBatch(kLogBatch);
        const ports::NetResult res = net_.postLogs(joinArray(batch));
        switch (res.kind) {
            case Kind::Ok:
                r.logsSent += static_cast<int>(batch.size());
                break;
            case Kind::Unauthorized:
                log_.requeue(std::move(batch));
                unauthorized(r, "logs");
                return false;
            case Kind::Transient:
            case Kind::NotModified:
                log_.requeue(std::move(batch));
                stop(r, "logs", res);
                return false;
            case Kind::Permanent:
                // The server rejected the lines themselves; requeueing would resend the poison every round.
                log_.warn("logs rejected", ("{\"status\":" + std::to_string(res.status) + ",\"dropped\":" + std::to_string(batch.size()) + "}").c_str());
                break;
        }
    }
    return true;
}

void SyncService::applyState(const std::string& json, const std::string& etag, bool persist) {
    domain::DeviceState s;
    std::string err;
    if (!decodeState(json, s, err)) {
        log_.error("state decode failed", ("{\"err\":\"" + err + "\"}").c_str());
        return;
    }
    state_ = std::move(s);
    hasState_ = true;
    etag_ = etag;
    ++generation_;
    if (persist) {
        storage_.write(kStateKey, json);
        storage_.write(kEtagKey, etag_);
    }
    syncClock(state_.nowMs);
}

bool SyncService::syncState(RoundResult& r) {
    const uint32_t before = generation_;
    const ports::NetResult res = net_.getState(hasState_ ? etag_ : "");
    switch (res.kind) {
        case Kind::Ok:
            applyState(res.body, res.etag, true);
            r.stateChanged = generation_ != before;
            return true;
        case Kind::NotModified:
            return true;
        case Kind::Unauthorized:
            unauthorized(r, "state");
            return false;
        case Kind::Transient:
        case Kind::Permanent:
            stop(r, "state", res);
            return false;
    }
    return true;
}

void SyncService::syncHeartbeat(RoundResult& r, uint32_t nowMs) {
    const std::string body = encodeHeartbeat(heartbeat_.fw.c_str(), nowMs / 1000u, heartbeat_.resetReason.c_str(),
                                             heartbeat_.freeHeap, heartbeat_.batteryPct);
    const ports::NetResult res = net_.postHeartbeat(body);
    if (res.ok()) {
        r.heartbeatOk = true;
        // A 304 state carries no `now`, so after a reboot with cached state this is the first clock sync.
        syncClock(serverNowOf(res.body));
        return;
    }
    if (res.kind == Kind::Unauthorized) { unauthorized(r, "heartbeat"); return; }
    log_.warn("heartbeat failed", statusJson(res.status).c_str());
}

}  // namespace feedme2::application
