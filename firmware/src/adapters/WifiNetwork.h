#pragma once

#include <string>

#include "ports/INetwork.h"

namespace feedme2::adapters {

// HTTPS client for the Phase 2a device API (not compiled under -DSIMULATOR=1).
// One short-lived TLS connection per call: the device sleeps between syncs and
// an idle session would not survive it anyway. `WiFiClientSecure::setInsecure()`
// because the worker sits behind Cloudflare's rotating edge certificate;
// pinning is a Phase 3 item. 8 s timeout per request. The token is sent as
// `Authorization: Bearer` on /device routes only; /pair routes are public.
// Status codes map through NetResult::fromStatus; a transport failure
// (no Wi-Fi, DNS, TLS, timeout) is status 0 with the HTTPClient error text.
class WifiNetwork final : public ports::INetwork {
public:
    // -DFEEDME2_BACKEND_URL from platformio.ini [env:crowpanel].
    static const char* const kDefaultBaseUrl;
    static constexpr uint32_t kTimeoutMs = 8000;

    explicit WifiNetwork(std::string baseUrl);

    bool isOnline() const override;
    ports::NetResult pairStart(const std::string& deviceId, const std::string& hwModel, const std::string& fw,
                               const std::string& pollSecret) override;
    ports::NetResult pairCheck(const std::string& deviceId, const std::string& pollSecret) override;
    ports::NetResult getState(const std::string& ifNoneMatch) override;
    ports::NetResult postFeedings(const std::string& jsonArray) override;
    ports::NetResult postLogs(const std::string& jsonArray) override;
    ports::NetResult postHeartbeat(const std::string& jsonBody) override;
    void setToken(const std::string& token) override { token_ = token; }

private:
    ports::NetResult request(const char* method, const std::string& path, const std::string& body,
                             bool withAuth, const std::string& ifNoneMatch = "");

    std::string baseUrl_;
    std::string token_;
};

}  // namespace feedme2::adapters
