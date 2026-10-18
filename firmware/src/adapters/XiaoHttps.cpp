#include "adapters/XiaoHttps.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ctime>
#include <utility>
#include "adapters/ScaleCaRoots.h"

namespace feedme2::adapters {
namespace {
bool validEndpoint(const std::string& base) {
    // The endpoint is a compile-time constant in PlatformIO. Reject HTTP,
    // userinfo, URL fragments, queries, ports and path-based redirection.
    constexpr const char* kScheme = "https://";
    if (base.compare(0, 8, kScheme) != 0 || base.size() <= 8) return false;
    const auto rest = base.substr(8);
    if (rest.find_first_of("/?#@:\\") != std::string::npos) return false;
    for (char ch : rest)
        if (!((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') ||
              ch == '-' || ch == '.')) return false;
    return rest.front() != '.' && rest.back() != '.';
}
bool utcClockReady() {
    const auto now = std::time(nullptr);
    return now >= 1704067200 && now < 4102444800LL;  // 2024..2100
}
std::string json(const JsonDocument& doc) {
    std::string out;
    serializeJson(doc, out);
    return out;
}
}

XiaoHttps::XiaoHttps(std::string baseUrl) : baseUrl_(std::move(baseUrl)) {}

bool XiaoHttps::isOnline() const {
    return validEndpoint(baseUrl_) && WiFi.status() == WL_CONNECTED && utcClockReady();
}

ports::NetResult XiaoHttps::request(const std::string& method, const std::string& path,
                                    const std::string& body, const std::string& token) {
    if (!validEndpoint(baseUrl_)) return ports::NetResult::fromStatus(0, "invalid_https_endpoint");
    if (WiFi.status() != WL_CONNECTED) return ports::NetResult::fromStatus(0, "offline");
    if (!utcClockReady()) return ports::NetResult::fromStatus(0, "clock_unsynced");
    if ((method != "GET" && method != "POST") ||
        (method == "POST" && body.empty()) || body.size() > 32 * 1024)
        return ports::NetResult::fromStatus(0, "invalid_request_size");
    WiFiClientSecure tls;
    tls.setCACert(kScaleCaRoots);  // chain AND hostname validation; never setInsecure
    HTTPClient http;
    http.setTimeout(kTimeoutMs);
    http.setReuse(false);
    http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    if (!http.begin(tls, String((baseUrl_ + path).c_str())))
        return ports::NetResult::fromStatus(0, "https_begin_failed");
    http.addHeader("Content-Type", "application/json");
    if (!token.empty()) http.addHeader("Authorization", String("Bearer ") + token.c_str());
    const int status = method == "GET" ? http.GET() : http.sendRequest("POST",
        reinterpret_cast<uint8_t*>(const_cast<char*>(body.data())), body.size());
    std::string response;
    if (status > 0) {
        const int size = http.getSize();
        if (size > 16384) {
            http.end();
            return ports::NetResult::fromStatus(0, "response_too_large");
        }
        response = http.getString().c_str();
        if (response.size() > 16384) {
            http.end();
            return ports::NetResult::fromStatus(0, "response_too_large");
        }
    } else response = "tls_or_transport_error";  // never log token or pollSecret
    http.end();
    return ports::NetResult::fromStatus(status > 0 ? status : 0, std::move(response));
}

ports::NetResult XiaoHttps::pairStart(const std::string& id, const std::string& fw,
                                      const std::string& secret) {
    JsonDocument doc;
    doc["deviceId"] = id;
    doc["hwModel"] = "xiao-esp32s3-sense-scale";
    doc["fwVersion"] = fw;
    doc["pollSecret"] = secret;
    return request("POST", "/api/pair/start", json(doc));
}

ports::NetResult XiaoHttps::pairCheck(const std::string& id, const std::string& secret) {
    JsonDocument doc;
    doc["deviceId"] = id;
    doc["pollSecret"] = secret;
    return request("POST", "/api/pair/check", json(doc));
}

ports::NetResult XiaoHttps::postScaleEvents(const std::string& token,
                                            const std::string& jsonArray) {
    if (token.empty()) return ports::NetResult::fromStatus(0, "not_paired");
    return request("POST", "/api/device/scale-events", jsonArray, token);
}

ports::NetResult XiaoHttps::checkFirmware(const std::string& token) {
    if (token.empty()) return ports::NetResult::fromStatus(0, "not_paired");
    return request("GET", "/api/device/firmware/check", "", token);
}

}  // namespace feedme2::adapters
