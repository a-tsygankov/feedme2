#if !SIMULATOR

#include "adapters/WifiStation.h"

#include <Arduino.h>
#include <WiFi.h>

#include <algorithm>

namespace feedme2::adapters {

namespace {

void putString(std::string& blob, const std::string& s) {
    const uint16_t n = static_cast<uint16_t>(std::min<size_t>(s.size(), 0xFFFF));
    blob.push_back(static_cast<char>(n & 0xFF));
    blob.push_back(static_cast<char>((n >> 8) & 0xFF));
    blob.append(s.data(), n);
}

bool getString(const std::string& blob, size_t& pos, std::string& out) {
    if (pos + 2 > blob.size()) return false;
    const size_t n = static_cast<uint8_t>(blob[pos]) | (static_cast<size_t>(static_cast<uint8_t>(blob[pos + 1])) << 8);
    pos += 2;
    if (pos + n > blob.size()) return false;
    out.assign(blob.data() + pos, n);
    pos += n;
    return true;
}

}  // namespace

std::string WifiStation::encodeCredentials(const std::string& ssid, const std::string& pass) {
    std::string blob;
    blob.reserve(4 + ssid.size() + pass.size());
    putString(blob, ssid);
    putString(blob, pass);
    return blob;
}

bool WifiStation::decodeCredentials(const std::string& blob, std::string& ssid, std::string& pass) {
    size_t pos = 0;
    std::string s, p;
    if (!getString(blob, pos, s) || !getString(blob, pos, p) || s.empty()) return false;
    ssid = std::move(s);
    pass = std::move(p);
    return true;
}

bool WifiStation::loadCredentials(ports::IStorage& storage, std::string& ssid, std::string& pass) {
    std::string blob;
    if (!storage.read(kWifiKey, blob)) return false;
    return decodeCredentials(blob, ssid, pass);
}

bool WifiStation::connect(const std::string& ssid, const std::string& pass, uint32_t budgetMs) {
    if (ssid.empty()) return false;
    ssid_ = ssid;
    pass_ = pass;
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(ssid.c_str(), pass.c_str());
    // WiFi.begin() is asynchronous; the association is now in flight and ensureConnected() must
    // not restart it on its next probe, so it is booked like one of its own re-kicks. A budget of 0
    // returns at once and main.cpp's loop (which probes once a second) picks up the join.
    reconnectPending_ = true;
    lastReconnectMs_ = millis();
    // Unsigned delta rather than a `millis() < deadline` compare: a deadline computed near the
    // 49-day wrap would already be in the past and the first connect after it would fail instantly.
    const uint32_t started = millis();
    while (millis() - started < budgetMs) {
        if (WiFi.status() == WL_CONNECTED) break;
        delay(100);
    }
    return ensureConnected();
}

bool WifiStation::ensureConnected() {
    if (WiFi.status() == WL_CONNECTED) {
        if (reconnectPending_) {
            // The connected transition of a join this object kicked off (boot or a wake re-kick):
            // start SNTP here rather than in connect(), which no longer waits for the association.
            // Zero offsets: the app renders in the house timezone from the server's tzOffsetMin.
            configTime(0, 0, "pool.ntp.org", "time.google.com");
            reconnectPending_ = false;
        }
        return true;
    }
    if (ssid_.empty()) return false;  // connect() never ran: nothing to re-associate with
    const uint32_t now = millis();
    // Rate limited: a begin() while the previous attempt is still associating restarts it and
    // the device would never finish connecting.
    if (reconnectPending_ && now - lastReconnectMs_ < kReconnectIntervalMs) return false;
    reconnectPending_ = true;
    lastReconnectMs_ = now;
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid_.c_str(), pass_.c_str());
    return false;
}

bool WifiStation::isConnected() const { return WiFi.status() == WL_CONNECTED; }

int8_t WifiStation::rssi() const {
    if (WiFi.status() != WL_CONNECTED) return 0;
    return static_cast<int8_t>(WiFi.RSSI());
}

std::vector<std::pair<std::string, int8_t>> WifiStation::scan() {
    std::vector<std::pair<std::string, int8_t>> out;
    const int n = WiFi.scanNetworks(/*async=*/false, /*show_hidden=*/false);
    for (int i = 0; i < n; ++i) {
        const String s = WiFi.SSID(i);
        if (s.length() == 0) continue;
        out.emplace_back(std::string(s.c_str()), static_cast<int8_t>(WiFi.RSSI(i)));
    }
    WiFi.scanDelete();
    std::stable_sort(out.begin(), out.end(), [](const auto& a, const auto& b) { return a.second > b.second; });
    return out;
}

}  // namespace feedme2::adapters

#endif  // !SIMULATOR
