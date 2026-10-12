#if !SIMULATOR

#include "adapters/WifiNetwork.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include <utility>

#ifndef FEEDME2_BACKEND_URL
#error "WifiNetwork needs -DFEEDME2_BACKEND_URL (see platformio.ini [env:crowpanel])"
#endif

namespace feedme2::adapters {

const char* const WifiNetwork::kDefaultBaseUrl = FEEDME2_BACKEND_URL;

namespace {

std::string serialize(const JsonDocument& doc) {
    std::string out;
    serializeJson(doc, out);
    return out;
}

}  // namespace

WifiNetwork::WifiNetwork(std::string baseUrl) : baseUrl_(std::move(baseUrl)) {}

bool WifiNetwork::isOnline() const { return WiFi.status() == WL_CONNECTED; }

ports::NetResult WifiNetwork::request(const char* method, const std::string& path, const std::string& body,
                                      bool withAuth, const std::string& ifNoneMatch) {
    if (WiFi.status() != WL_CONNECTED) return ports::NetResult::fromStatus(0, "offline");
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    http.setTimeout(kTimeoutMs);
    // Connection: close, so each call is one short-lived TLS connection (see the header). With the
    // default keep-alive, a response without Content-Length (a 304 or a 202 from the edge) makes
    // getString() read the identity body until the peer closes, which on a kept-alive connection
    // is Cloudflare's idle timeout: loop() (render, knob, Wi-Fi probe) froze for that long.
    http.setReuse(false);
    // No automatic redirect following: a 3xx from the edge would otherwise replay a POST elsewhere.
    if (!http.begin(client, String((baseUrl_ + path).c_str()))) return ports::NetResult::fromStatus(0, "bad url");
    http.addHeader("Content-Type", "application/json");
    if (withAuth && !token_.empty()) http.addHeader("Authorization", String("Bearer ") + token_.c_str());
    if (!ifNoneMatch.empty()) http.addHeader("If-None-Match", ifNoneMatch.c_str());
    static const char* kCollect[] = {"ETag"};
    http.collectHeaders(kCollect, 1);
    // HTTPClient's payload parameter is non-const; it only reads it.
    uint8_t* payload = body.empty() ? nullptr : reinterpret_cast<uint8_t*>(const_cast<char*>(body.data()));
    const int status = http.sendRequest(method, payload, body.size());
    std::string resp;
    std::string etag;
    if (status > 0) {
        resp = http.getString().c_str();
        etag = http.header("ETag").c_str();
    } else {
        // Negative HTTPC_ERROR_* codes all mean "the request never completed": one transient status
        // for the caller, the reason in the body for the log.
        resp = HTTPClient::errorToString(status).c_str();
    }
    http.end();
    return ports::NetResult::fromStatus(status > 0 ? status : 0, std::move(resp), std::move(etag));
}

ports::NetResult WifiNetwork::pairStart(const std::string& deviceId, const std::string& hwModel, const std::string& fw,
                                        const std::string& pollSecret) {
    JsonDocument doc;
    doc["deviceId"] = deviceId;
    doc["hwModel"] = hwModel;
    doc["fwVersion"] = fw;
    doc["pollSecret"] = pollSecret;
    return request("POST", "/api/pair/start", serialize(doc), /*withAuth=*/false);
}

ports::NetResult WifiNetwork::pairCheck(const std::string& deviceId, const std::string& pollSecret) {
    JsonDocument doc;
    doc["deviceId"] = deviceId;
    doc["pollSecret"] = pollSecret;
    return request("POST", "/api/pair/check", serialize(doc), /*withAuth=*/false);
}

ports::NetResult WifiNetwork::getState(const std::string& ifNoneMatch) {
    return request("GET", "/api/device/state", "", /*withAuth=*/true, ifNoneMatch);
}

ports::NetResult WifiNetwork::postFeedings(const std::string& jsonArray) {
    return request("POST", "/api/device/feedings", jsonArray, /*withAuth=*/true);
}

ports::NetResult WifiNetwork::postLogs(const std::string& jsonArray) {
    return request("POST", "/api/device/logs", jsonArray, /*withAuth=*/true);
}

ports::NetResult WifiNetwork::postHeartbeat(const std::string& jsonBody) {
    return request("POST", "/api/device/heartbeat", jsonBody, /*withAuth=*/true);
}

}  // namespace feedme2::adapters

#endif  // !SIMULATOR
