#pragma once

#include <cstdint>
#include <string>
#include "ports/INetwork.h"

namespace feedme2::ports {

// Narrow network port: XIAO never posts manual feedings or device logs.
// Implementations MUST authenticate TLS, reject redirects and avoid logging
// bearer tokens or pairing poll secrets.
class IScaleTransport {
public:
    virtual ~IScaleTransport() = default;
    virtual bool isOnline() const = 0;
    virtual NetResult pairStart(const std::string& deviceId, const std::string& firmwareVersion,
                                const std::string& pollSecret) = 0;
    virtual NetResult pairCheck(const std::string& deviceId, const std::string& pollSecret) = 0;
    virtual NetResult postScaleEvents(const std::string& token, const std::string& jsonArray) = 0;
};

}  // namespace feedme2::ports
