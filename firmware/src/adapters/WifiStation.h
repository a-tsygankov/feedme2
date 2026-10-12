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

    // Blocks up to budgetMs for the association + DHCP. On success starts SNTP
    // (pool.ntp.org, time.google.com) so the system clock is sane for TLS and
    // log timestamps; wall time for the app still comes from the server `now`.
    bool connect(const std::string& ssid, const std::string& pass, uint32_t budgetMs = kDefaultBudgetMs);
    // Non-blocking. A manual esp_light_sleep_start() (EspPower::lightSleep) drops the association:
    // only esp_pm's automatic light sleep coordinates with modem sleep. So after every wake the
    // first sync would see WL_CONNECTED gone. This returns the current status and, when it has
    // dropped, re-kicks WiFi.begin() with the credentials connect() was given, at most once per
    // kReconnectIntervalMs; App calls it after wake and lets SyncService's transient path retry.
    bool ensureConnected();
    bool isConnected() const;
    // dBm, 0 when not associated.
    int8_t rssi() const;
    // Named networks in range, strongest first; blocking (~2-3 s).
    std::vector<std::pair<std::string, int8_t>> scan();

    static constexpr uint32_t kReconnectIntervalMs = 5000;

private:
    std::string ssid_;
    std::string pass_;
    uint32_t lastReconnectMs_ = 0;
    bool reconnectPending_ = false;
};

}  // namespace feedme2::adapters
