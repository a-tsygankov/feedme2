#include "application/ScaleNetService.h"

#include <ArduinoJson.h>
#include <cstring>
#include <utility>
#include "domain/Version.h"

namespace feedme2::application {
namespace {
bool validVersion(const std::string& s) {
    if (s.size() < 5 || s.size() > 32) return false;
    int dots = 0;
    int digits = 0;
    for (char ch : s) {
        if (ch == '.') {
            if (digits == 0) return false;
            ++dots;
            digits = 0;
        } else if (ch >= '0' && ch <= '9') ++digits;
        else return false;
    }
    return dots == 2 && digits > 0;
}
bool validCode(const std::string& code) {
    if (code.size() != 6) return false;
    for (char c : code) if (c < '0' || c > '9') return false;
    return true;
}
bool validUuid(const std::string& id) {
    if (id.size() != 36) return false;
    for (size_t i = 0; i < id.size(); ++i) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (id[i] != '-') return false;
        } else if (!((id[i] >= '0' && id[i] <= '9') ||
                     (id[i] >= 'a' && id[i] <= 'f'))) return false;
    }
    return true;
}
bool validSecret(const std::string& s) {
    if (s.size() != 32 && s.size() != 64) return false;
    for (char c : s)
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}
}

ScaleNetService::ScaleNetService(ports::IScaleTransport& net, ports::IStorage& storage,
                                 ports::IRandom& random, ScaleOutbox& outbox,
                                 std::string deviceId, std::string fwVersion)
    : net_(net), storage_(storage), random_(random), outbox_(outbox),
      deviceId_(std::move(deviceId)), fwVersion_(std::move(fwVersion)) {}

bool ScaleNetService::validDeviceId(const std::string& id) {
    if (id.size() != 32) return false;
    for (char c : id)
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}

bool ScaleNetService::restore() {
    paired_ = false;
    pairing_ = false;
    firmwareChecked_ = false;
    firmwareUpdateAvailable_ = false;
    latestFirmware_.clear();
    token_.clear();
    code_.clear();
    secret_.clear();
    std::string blob;
    if (!storage_.read(kAuthKey, blob)) return true;  // factory-new device
    JsonDocument doc;
    if (deserializeJson(doc, blob) || !doc.is<JsonObjectConst>()) return false;
    JsonObjectConst obj = doc.as<JsonObjectConst>();
    if (obj.size() != 3 || !obj["deviceId"].is<const char*>() ||
        !obj["token"].is<const char*>() || !obj["epoch"].is<const char*>()) return false;
    const std::string id = obj["deviceId"].as<const char*>();
    const std::string token = obj["token"].as<const char*>();
    const std::string epoch = obj["epoch"].as<const char*>();
    if (id != deviceId_ || token.empty() || token.size() > 4096 || !validUuid(epoch)) return false;
    if (!outbox_.activatePairing(epoch)) return false;
    token_ = token;
    paired_ = true;
    return true;
}

bool ScaleNetService::startPairing(uint32_t nowMs) {
    if (paired_ || !net_.isOnline() || !validDeviceId(deviceId_)) return false;
    secret_ = random_.hex(16);
    if (!validSecret(secret_)) return false;
    code_.clear();
    pairing_ = false;
    blocked_ = false;
    const auto r = net_.pairStart(deviceId_, fwVersion_, secret_);
    lastStatus_ = r.status;
    if (r.status != 200) { error_ = "pair_start_failed"; secret_.clear(); return false; }
    JsonDocument doc;
    if (deserializeJson(doc, r.body) || !doc["pairCode"].is<const char*>() ||
        !doc["pollAfterSec"].is<int>()) {
        error_ = "pair_start_malformed";
        secret_.clear();
        return false;
    }
    const std::string code = doc["pairCode"].as<const char*>();
    if (!validCode(code)) { error_ = "pair_code_invalid"; secret_.clear(); return false; }
    code_ = code;
    lastPollMs_ = nowMs;
    error_.clear();
    pairing_ = true;
    return true;
}

bool ScaleNetService::savePairing(const std::string& token, const std::string& epoch) {
    if (token.empty() || token.size() > 4096 || !validUuid(epoch)) return false;
    if (!outbox_.activatePairing(epoch)) return false;
    JsonDocument doc;
    doc["deviceId"] = deviceId_;
    doc["token"] = token;
    doc["epoch"] = epoch;
    std::string blob;
    serializeJson(doc, blob);
    if (!storage_.write(kAuthKey, blob)) return false;
    token_ = token;
    paired_ = true;
    pairing_ = false;
    code_.clear();
    secret_.clear();
    lastUploadMs_ = 0;
    firmwareChecked_ = false;
    firmwareUpdateAvailable_ = false;
    latestFirmware_.clear();
    return true;
}

void ScaleNetService::poll(uint32_t nowMs) {
    lastPollMs_ = nowMs;
    const auto r = net_.pairCheck(deviceId_, secret_);
    lastStatus_ = r.status;
    if (r.status != 200) {
        if (r.kind != ports::NetResult::Kind::Transient) error_ = "pair_check_failed";
        return;
    }
    JsonDocument doc;
    if (deserializeJson(doc, r.body) || !doc["status"].is<const char*>()) {
        error_ = "pair_check_malformed";
        return;
    }
    const char* status = doc["status"].as<const char*>();
    if (std::strcmp(status, "pending") == 0) return;
    if (std::strcmp(status, "confirmed") == 0) {
        if (!doc["deviceToken"].is<const char*>() || !doc["houseId"].is<const char*>()) {
            error_ = "pair_confirm_malformed";
            return;
        }
        const std::string token = doc["deviceToken"].as<const char*>();
        const std::string epoch = random_.uuid();
        if (!savePairing(token, epoch)) { error_ = "pair_storage_failed"; return; }
        error_.clear();
        return;
    }
    if (std::strcmp(status, "expired") == 0 || std::strcmp(status, "unknown") == 0) {
        pairing_ = false;
        code_.clear();
        secret_.clear();
        error_ = "pair_expired";
    } else error_ = "pair_status_invalid";
}

void ScaleNetService::upload(uint32_t nowMs) {
    lastUploadMs_ = nowMs;
    if (!paired_ || blocked_ || !net_.isOnline() || !outbox_.active()) return;
    const auto batch = outbox_.batch();
    if (batch.empty()) return;
    const auto body = outbox_.encodeBatch(batch);
    if (body.empty()) { error_ = "queue_encode_failed"; blocked_ = true; return; }
    const auto r = net_.postScaleEvents(token_, body);
    lastStatus_ = r.status;
    if (r.status == 201 && outbox_.acknowledge201(r.status, r.body, batch)) {
        error_.clear();
        return;
    }
    if (r.status == 401) {
        // The server revoked this token. Preserve old-epoch observations on
        // flash but never upload them under a new pairing.
        if (storage_.erase(kAuthKey)) {
            token_.clear();
            paired_ = false;
            error_ = "token_revoked";
        } else {
            blocked_ = true;
            error_ = "token_erase_failed";
        }
        return;
    }
    if (r.status == 409) {
        blocked_ = true;
        error_ = "event_conflict";
    } else error_ = r.status == 201 ? "ack_invalid" : "upload_failed";
}

void ScaleNetService::checkFirmwareNow(uint32_t nowMs) {
    if (!paired_ || !net_.isOnline()) return;
    lastFirmwareCheckMs_ = nowMs;
    firmwareChecked_ = true;
    const auto r = net_.checkFirmware(token_);
    firmwareCheckStatus_ = r.status;
    if (r.status != 200 || r.body.size() > 2048) return;
    JsonDocument doc;
    if (deserializeJson(doc, r.body) || !doc.is<JsonObjectConst>() ||
        !doc["updateAvailable"].is<bool>() || !doc["installSupported"].is<bool>() ||
        doc["installSupported"].as<bool>()) return;
    const auto latest = doc["latest"];
    if (!latest.isNull() && !latest.is<const char*>()) return;
    if (latest.isNull()) {
        if (doc["updateAvailable"].as<bool>()) return;
        latestFirmware_.clear();
        firmwareUpdateAvailable_ = false;
        return;
    }
    const std::string version = latest.as<const char*>();
    if (!validVersion(version) || !validVersion(fwVersion_)) return;
    // Never trust an arbitrary server-side flag to claim an update.
    const bool newer = domain::compareVersions(version, fwVersion_) > 0;
    if (newer != doc["updateAvailable"].as<bool>()) return;
    latestFirmware_ = version;
    firmwareUpdateAvailable_ = newer;
}

void ScaleNetService::syncNow(uint32_t nowMs) {
    if (paired_ && !blocked_ && net_.isOnline()) upload(nowMs);
}

void ScaleNetService::tick(uint32_t nowMs) {
    if (!net_.isOnline()) return;
    if (pairing_ && nowMs - lastPollMs_ >= kPollMs) {
        poll(nowMs);
        return; // never issue two HTTPS calls in one sampling tick
    }
    if (paired_ && !blocked_ && nowMs - lastUploadMs_ >= kRetryMs && outbox_.pending() > 0) {
        upload(nowMs);
        return; // preserve telemetry priority over version checks
    }
    if (paired_ && (!firmwareChecked_ || nowMs - lastFirmwareCheckMs_ >= kFirmwareCheckMs))
        checkFirmwareNow(nowMs);
}

bool ScaleNetService::unpair() {
    if (!storage_.erase(kAuthKey)) return false;
    token_.clear();
    paired_ = false;
    pairing_ = false;
    blocked_ = false;
    code_.clear();
    secret_.clear();
    error_.clear();
    firmwareChecked_ = false;
    firmwareUpdateAvailable_ = false;
    latestFirmware_.clear();
    return true;
}

bool ScaleNetService::enqueueStable(int64_t utcMs, uint32_t revision, int32_t mg) {
    return paired_ && !blocked_ && outbox_.active() &&
        outbox_.enqueue(ScaleEventKind::StableWeight, utcMs, revision, mg);
}

bool ScaleNetService::enqueueBowlTransition(bool returned, int64_t utcMs,
                                            uint32_t revision, int32_t grossMg) {
    return paired_ && !blocked_ && outbox_.active() &&
        outbox_.enqueue(returned ? ScaleEventKind::BowlReturned : ScaleEventKind::BowlRemoved,
                        utcMs, revision, returned ? grossMg : 0);
}

}  // namespace feedme2::application
