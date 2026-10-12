#pragma once
#include <cstdint>
#include <string>
#include <utility>

namespace feedme2::ports {

// Outcome of one device API call. Mapping rule (fromStatus):
//   2xx -> Ok, 304 -> NotModified, 401 -> Unauthorized (the pairing is gone: pair again),
//   other 4xx -> Permanent (retrying the same body cannot help),
//   5xx, 408, 429 and transport failures (status <= 0) -> Transient (keep the data, retry later).
struct NetResult {
    enum class Kind : uint8_t { Ok, NotModified, Transient, Unauthorized, Permanent };
    Kind kind = Kind::Transient;
    int status = 0;
    std::string body;
    std::string etag;
    bool ok() const { return kind == Kind::Ok; }
    static NetResult fromStatus(int status, std::string body, std::string etag = "") {
        NetResult r; r.status = status; r.body = std::move(body); r.etag = std::move(etag);
        if (status == 304) r.kind = Kind::NotModified;
        else if (status >= 200 && status < 300) r.kind = Kind::Ok;
        else if (status == 401) r.kind = Kind::Unauthorized;
        else if (status == 408 || status == 429 || status >= 500 || status <= 0) r.kind = Kind::Transient;
        else r.kind = Kind::Permanent;
        return r;
    }
};

class INetwork {
public:
    virtual ~INetwork() = default;
    virtual bool isOnline() const = 0;
    // pollSecret: device-generated, fresh per pairing attempt; the server hands the token only to its holder.
    virtual NetResult pairStart(const std::string& deviceId, const std::string& hwModel, const std::string& fw, const std::string& pollSecret) = 0;
    virtual NetResult pairCheck(const std::string& deviceId, const std::string& pollSecret) = 0;
    virtual NetResult getState(const std::string& ifNoneMatch) = 0;
    virtual NetResult postFeedings(const std::string& jsonArray) = 0;
    virtual NetResult postLogs(const std::string& jsonArray) = 0;
    virtual NetResult postHeartbeat(const std::string& jsonBody) = 0;
    virtual void setToken(const std::string& token) = 0;
};

}  // namespace feedme2::ports
