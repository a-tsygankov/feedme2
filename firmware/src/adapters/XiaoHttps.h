#pragma once

#include <string>
#include "ports/IScaleTransport.h"

namespace feedme2::adapters {

// Fixed HTTPS API endpoint. CA and hostname verified on EVERY request.
// Never reuses CrowPanel's legacy setInsecure() transport.
class XiaoHttps final : public ports::IScaleTransport {
public:
    static constexpr uint32_t kTimeoutMs = 8000;
    explicit XiaoHttps(std::string baseUrl);
    bool isOnline() const override;
    ports::NetResult pairStart(const std::string& deviceId, const std::string& fw,
                               const std::string& pollSecret) override;
    ports::NetResult pairCheck(const std::string& deviceId, const std::string& pollSecret) override;
    ports::NetResult postScaleEvents(const std::string& token, const std::string& jsonArray) override;
    ports::NetResult checkFirmware(const std::string& token) override;
private:
    ports::NetResult request(const std::string& method, const std::string& path, const std::string& body,
                          const std::string& token = "");
    std::string baseUrl_;
};

}  // namespace feedme2::adapters
