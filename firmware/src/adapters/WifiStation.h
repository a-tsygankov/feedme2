#pragma once

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "ports/IStorage.h"

namespace feedme2::adapters {

// Station-mode Wi-Fi on the ESP32-S3 (not compiled under -DSIMULATOR=1).
// Credentials live in NVS under the key `wifi` as `[u16 len][ssid][u16 len][pass]`
// (little-endian lengths), the format howler's portal and App share; the
// captive portal writes it through encodeCredentials() so there is exactly
// one definition of the blob.
class WifiStation {
public:
    static constexpr const char* kWifiKey = "wifi";
    static constexpr uint32_t kDefaultBudgetMs = 15000;

    static std::string encodeCredentials(const std::string& ssid, const std::string& pass);
    static bool decodeCredentials(const std::string& blob, std::string& ssid, std::string& pass);

    // False when nothing is stored or the blob is torn; the caller runs the captive portal then.
    bool loadCredentials(ports::IStorage& storage, std::string& ssid, std::string& pass);

    // Keeps the credentials and issues WiFi.begin(), which is asynchronous: the association is
    // then "in flight" and owned by ensureConnected(), which gives it kJoinBudgetMs before it may
    // be re-kicked and starts SNTP (pool.ntp.org, time.google.com) on the connected transition so
    // the clock is sane for TLS and log timestamps (app wall time still comes from the server
    // `now`). With budgetMs == 0 (main.cpp) it returns at once and the once-a-second probe picks
    // the join up; a budgetMs > 0 additionally polls for the association that long before
    // returning. Returns whether the station is connected on return.
    bool connect(const std::string& ssid, const std::string& pass, uint32_t budgetMs = kDefaultBudgetMs);
    // Non-blocking and cheap (one status read plus timestamps). Returns the current status and,
    // when the link has dropped, re-kicks WiFi.begin() with the credentials connect() was given.
    // A begin() this object issued is left alone for kJoinBudgetMs unless the stack reports a
    // definitive failure (WL_CONNECT_FAILED, WL_NO_SSID_AVAIL); re-kicks are never closer than
    // kReconnectIntervalMs apart. main.cpp probes it once a second.
    bool ensureConnected();
    // Call as soon as a manual light sleep (EspPower::lightSleep) returns, before anything reads
    // the link. That sleep drops the association (only esp_pm's automatic light sleep coordinates
    // with modem sleep), but the driver status lags: WiFi.status() still reads WL_CONNECTED, so
    // the wake sync went out over a dead link, failed, and the device waited for the 60 s retry.
    // This forces a clean rejoin (disconnect + begin) that gets the normal kJoinBudgetMs; a no-op
    // before connect().
    void noteWake(uint32_t nowMs);
    bool isConnected() const;
    // dBm, 0 when not associated.
    int8_t rssi() const;
    // Named networks in range, strongest first; blocking (~2-3 s).
    std::vector<std::pair<std::string, int8_t>> scan();

    // Minimum spacing between two WiFi.begin() calls from this object.
    static constexpr uint32_t kReconnectIntervalMs = 5000;
    // How long an in-flight association may take before ensureConnected() restarts it. A join
    // normally takes 3-8 s (DHCP, weak signal), so re-kicking at the 5 s gate restarted every slow
    // join and some stations never came up; the association gets its own, longer budget.
    static constexpr uint32_t kJoinBudgetMs = 15000;
    // How long noteWake() waits for the disconnect to clear the stale WL_CONNECTED.
    static constexpr uint32_t kWakeSettleMs = 150;

private:
    void beginJoin(uint32_t nowMs);

    std::string ssid_;
    std::string pass_;
    // millis() of the last WiFi.begin() this object issued: both the kReconnectIntervalMs gate
    // and the kJoinBudgetMs budget count from it.
    uint32_t lastBeginMs_ = 0;
    // True from a WiFi.begin() until WL_CONNECTED is observed (SNTP starts on that transition).
    bool joinInFlight_ = false;
};

}  // namespace feedme2::adapters
