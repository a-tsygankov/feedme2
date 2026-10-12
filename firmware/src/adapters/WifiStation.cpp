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
    WiFi.setAutoReconnect(true);
    // WiFi.begin() is asynchronous; the association is now in flight and booked exactly like an
    // ensureConnected() re-kick, so the probe leaves it alone for kJoinBudgetMs. A budget of 0
    // returns at once and main.cpp's loop (which probes once a second) picks up the join.
    beginJoin(millis());
    // Unsigned delta rather than a `millis() < deadline` compare: a deadline computed near the
    // 49-day wrap would already be in the past and the first connect after it would fail instantly.
    const uint32_t started = millis();
    while (millis() - started < budgetMs) {
        if (WiFi.status() == WL_CONNECTED) break;
        delay(100);
    }
    return ensureConnected();
}

void WifiStation::beginJoin(uint32_t nowMs) {
    joinInFlight_ = true;
    lastBeginMs_ = nowMs;
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid_.c_str(), pass_.c_str());
}

bool WifiStation::ensureConnected() {
    const wl_status_t status = WiFi.status();
    if (status == WL_CONNECTED) {
        if (joinInFlight_) {
            // The connected transition of a join this object kicked off (boot or a wake re-kick):
            // start SNTP here rather than in connect(), which does not wait for the association.
            // Zero offsets: the app renders in the house timezone from the server's tzOffsetMin.
            configTime(0, 0, "pool.ntp.org", "time.google.com");
            joinInFlight_ = false;
        }
        return true;
    }
    if (ssid_.empty()) return false;  // connect() never ran: nothing to re-associate with
    const uint32_t now = millis();
    const uint32_t sinceBegin = now - lastBeginMs_;
    if (joinInFlight_) {
        // A begin() restarts the association, so an attempt that is still joining must not be
        // re-kicked: with only the 5 s gate every join slower than that (slow DHCP, weak signal;
        // 3-8 s is normal) was restarted and some stations never came up. The attempt keeps its
        // kJoinBudgetMs unless the stack has already given up on it (wrong password, AP out of
        // range), in which case only the gate below applies.
        const bool failed = status == WL_CONNECT_FAILED || status == WL_NO_SSID_AVAIL;
        if (!failed && sinceBegin < kJoinBudgetMs) return false;
    }
    // Never two begin() calls closer than the gate, whichever path led here (a drop after a
    // successful join re-kicks at once because the last begin() is long past).
    if (sinceBegin < kReconnectIntervalMs) return false;
    beginJoin(now);
    return false;
}

void WifiStation::noteWake(uint32_t nowMs) {
    if (ssid_.empty()) return;  // connect() never ran: nothing to rejoin
    // Why a forced rejoin rather than "distrust WL_CONNECTED until localIP() and a fresh status
    // confirm it": neither signal is fresh after a manual light sleep. lwIP keeps the DHCP address
    // on the netif until the lost-IP timer fires, so localIP() is as stale as the status bits, and
    // WiFi.begin() with an unchanged config returns early while status() reads WL_CONNECTED, so a
    // plain re-kick would be a no-op. disconnect() makes the status truthful at once (isOnline()
    // reads false, so SyncService holds the wake round instead of sending it into a dead link)
    // and the begin() below is booked as a join, so it gets kJoinBudgetMs like the boot join.
    // The cost, one 3-8 s join per wake, is paid anyway: the association never survives the nap.
    WiFi.disconnect(/*wifioff=*/false, /*eraseap=*/false);
    // The STA_DISCONNECTED event updates the status from the event task; until it lands begin()
    // would still see WL_CONNECTED and skip the connect. Bounded: if the driver never reports a
    // disconnect the link was not dropped after all and the probe treats it as connected.
    const uint32_t started = millis();
    while (WiFi.status() == WL_CONNECTED && millis() - started < kWakeSettleMs) delay(5);
    beginJoin(nowMs);
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
