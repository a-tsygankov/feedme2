#pragma once

#include <cstdint>
#include <string>
#include "application/ScaleOutbox.h"
#include "ports/IRandom.h"
#include "ports/IScaleTransport.h"
#include "ports/IStorage.h"

namespace feedme2::application {

// XIAO-only pairing and upload orchestration. No UI or Arduino dependencies.
// Pairing auth is stored in one NVS blob: token + fresh epoch + device ID.
// A changed token must NEVER inherit another token's pending observations.
class ScaleNetService {
public:
    static constexpr const char* kAuthKey = "scale_auth";
    static constexpr uint32_t kPollMs = 3000;
    static constexpr uint32_t kRetryMs = 60000;
    static constexpr uint32_t kFirmwareCheckMs = 6u * 60u * 60u * 1000u;

    ScaleNetService(ports::IScaleTransport& net, ports::IStorage& storage,
                    ports::IRandom& random, ScaleOutbox& outbox,
                    std::string deviceId, std::string fwVersion);

    bool restore();
    bool startPairing(uint32_t nowMs);
    void tick(uint32_t nowMs);
    void syncNow(uint32_t nowMs);
    void checkFirmwareNow(uint32_t nowMs);
    bool unpair();
    bool enqueueStable(int64_t utcMs, uint32_t calibrationRevision, int32_t grossMg);
    bool enqueueBowlTransition(bool returned, int64_t utcMs,
                               uint32_t calibrationRevision, int32_t grossMg);

    bool paired() const { return paired_; }
    bool pairing() const { return pairing_; }
    bool blocked() const { return blocked_; }
    const std::string& pairCode() const { return code_; }
    size_t pending() const { return outbox_.pending(); }
    int lastStatus() const { return lastStatus_; }
    const std::string& lastError() const { return error_; }
    bool firmwareUpdateAvailable() const { return firmwareUpdateAvailable_; }
    const std::string& latestFirmware() const { return latestFirmware_; }
    int firmwareCheckStatus() const { return firmwareCheckStatus_; }

private:
    bool savePairing(const std::string& token, const std::string& epoch);
    void poll(uint32_t nowMs);
    void upload(uint32_t nowMs);
    static bool validDeviceId(const std::string& id);

    ports::IScaleTransport& net_;
    ports::IStorage& storage_;
    ports::IRandom& random_;
    ScaleOutbox& outbox_;
    std::string deviceId_;
    std::string fwVersion_;
    std::string token_;
    std::string code_;
    std::string secret_;
    std::string error_;
    uint32_t lastPollMs_ = 0;
    uint32_t lastUploadMs_ = 0;
    uint32_t lastFirmwareCheckMs_ = 0;
    int firmwareCheckStatus_ = 0;
    std::string latestFirmware_;
    bool firmwareUpdateAvailable_ = false;
    bool firmwareChecked_ = false;
    int lastStatus_ = 0;
    bool paired_ = false;
    bool pairing_ = false;
    bool blocked_ = false;
};

}  // namespace feedme2::application
