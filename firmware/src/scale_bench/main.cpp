// Isolated USB bench firmware for XIAO ESP32S3 Sense + HX711.
// NO Wi-Fi, camera, automatic feeding, OTA or cloud sync in this target.
// Calibration requires explicit operator actions and is persisted in NVS.
#include <Arduino.h>
#include <Preferences.h>
#include <esp_timer.h>
#include <cstdio>
#include <cstring>
#include <optional>
#include <string>

#include "adapters/Hx711Scale.h"
#include "domain/ScaleCalibration.h"
#include "domain/ScaleStability.h"
#if defined(SCALE_NETWORK)
#include "domain/BowlLiftDetector.h"
#endif
#if defined(SCALE_NETWORK)
#include <ArduinoJson.h>
#include <WiFi.h>
#include <LittleFS.h>
#include <sys/time.h>
#include <esp_mac.h>
#include "adapters/EspRandom.h"
#include "adapters/LittleFsQueue.h"
#include "adapters/NvsStorage.h"
#include "adapters/XiaoHttps.h"
#include "application/ScaleNetService.h"
#include "application/Version.h"
#include "application/ScaleOutbox.h"
#endif

using feedme2::adapters::Hx711Scale;
using namespace feedme2::domain::scale;

namespace {
constexpr uint32_t kMagic = 0x53434c31;  // SCL1
constexpr uint64_t kMissingMs = 1500;
constexpr uint64_t kRawPrintMs = 500;
constexpr uint64_t kStablePrintMs = 1000;
struct StoredCalibration {
    uint32_t magic;
    Calibration config;
    uint32_t checksum;
};

uint32_t checksum(const StoredCalibration& value) {
    // Explicit fields; no struct-padding-dependent hash.
    uint32_t h = 2166136261u;
    auto mix = [&h](uint32_t word) {
        for (int i = 0; i < 4; ++i) {
            h = (h ^ (word & 0xffu)) * 16777619u;
            word >>= 8;
        }
    };
    mix(value.magic);
    mix(static_cast<uint32_t>(value.config.zeroRaw));
    mix(static_cast<uint32_t>(value.config.referenceRaw));
    mix(static_cast<uint32_t>(value.config.referenceMg));
    mix(static_cast<uint32_t>(value.config.maxGrossMg));
    mix(value.config.revision);
    return h;
}

uint64_t nowMs() { return static_cast<uint64_t>(esp_timer_get_time()) / 1000; }

Hx711Scale adc(SCALE_HX711_DOUT_PIN, SCALE_HX711_SCK_PIN);
Preferences nvs;
Calibration saved{};
Calibration pending{};
bool zeroCaptured = false;
bool refCaptured = false;
bool limitSet = false;
StabilityConfig tuning{};
std::optional<WeightStabilityEstimator> estimator;
bool samplingEnabled = false;
bool haveRaw = false;
bool missingReported = false;
int32_t lastRaw = 0;
uint64_t lastSampleMs = 0;
uint64_t lastPrintMs = 0;
uint64_t lastStablePrintMs = 0;
std::string command;

#if defined(SCALE_NETWORK)
feedme2::adapters::NvsStorage scaleStorage;
feedme2::adapters::LittleFsQueue scaleFiles(/*formatOnFail=*/false);
feedme2::adapters::EspRandom scaleRandom;
feedme2::application::ScaleOutbox scaleOutbox(scaleFiles, scaleStorage, scaleRandom);
feedme2::adapters::XiaoHttps scaleHttps(FEEDME2_BACKEND_URL);
std::optional<feedme2::application::ScaleNetService> scaleNet;
bool haveStable = false;
int32_t stableGrossMg = 0;
uint32_t stableRevision = 0;
uint64_t stableAtMs = 0;
uint64_t lastRecordMs = 0;
bool lastPaired = false;
std::optional<BowlLiftDetector> bowlDetector;
bool bowlWatch = false;

void disableBowlWatch(const char* reason) {
    if (bowlWatch) Serial.printf("Bowl watch stopped: %s\\n", reason);
    bowlWatch = false;
    bowlDetector.reset();
}

void observeBowl(uint64_t atMs, int32_t grossMg, uint32_t revision) {
    if (!bowlWatch || !bowlDetector || !scaleNet) return;
    struct timeval tv {};
    gettimeofday(&tv, nullptr);
    const int64_t utcMs = static_cast<int64_t>(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
    if (utcMs < 1704067200000LL || utcMs > 4102444800000LL ||
        !scaleNet->paired() || scaleNet->blocked()) {
        disableBowlWatch("clock, pairing or queue not ready");
        return;
    }
    const auto r = bowlDetector->observe(atMs, grossMg, revision);
    if (r.fault != BowlFault::None) {
        disableBowlWatch("sensor, calibration or lift timeout; reset required");
        return;
    }
    if (r.event == BowlEvent::None) return;
    const bool returned = r.event == BowlEvent::Returned;
    if (!scaleNet->enqueueBowlTransition(returned, utcMs, revision, grossMg)) {
        disableBowlWatch("queue write failed; investigate flash before restarting");
        return;
    }
    if (returned)
        Serial.printf("REVIEW-ONLY bowl return: before=%ld after=%ld deltaMg=%ld (unverified bowl; NOT feeding)\\n",
            static_cast<long>(r.beforeMg), static_cast<long>(r.afterMg), static_cast<long>(r.deltaMg));
    else Serial.printf("Bowl removed, pre-lift grossMg=%ld; queued.\\n", static_cast<long>(r.beforeMg));
}


std::string deviceId() {
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char id[33];
    std::snprintf(id, sizeof id, "00000000000000000000%02x%02x%02x%02x%02x%02x",
                  mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return id;
}

void connectStoredWifi() {
    std::string savedWifi;
    if (!scaleStorage.read("scale_wifi", savedWifi)) return;
    JsonDocument doc;
    if (deserializeJson(doc, savedWifi) || !doc["ssid"].is<const char*>() ||
        !doc["pass"].is<const char*>()) return;
    const std::string ssid = doc["ssid"].as<const char*>();
    const std::string password = doc["pass"].as<const char*>();
    if (ssid.empty() || ssid.size() > 32 || password.size() < 8 || password.size() > 63) return;
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(ssid.c_str(), password.c_str());
    configTime(0, 0, "time.google.com", "pool.ntp.org");
}

void networkCommand(const std::string& line) {
    if (!scaleNet) return;
    if (line.rfind("wifi ", 0) == 0) {
        const std::string value = line.substr(5);
        const size_t sep = value.find('|');
        if (sep == std::string::npos || sep == 0 || sep > 32 ||
            value.size() - sep - 1 < 8 || value.size() - sep - 1 > 63) {
            Serial.println("Usage: wifi <ssid>|<WPA2-password> (USB-only, do not share serial transcript)");
            return;
        }
        JsonDocument doc;
        doc["ssid"] = value.substr(0, sep);
        doc["pass"] = value.substr(sep + 1);
        std::string blob;
        serializeJson(doc, blob);
        if (!scaleStorage.write("scale_wifi", blob)) {
            Serial.println("Wi-Fi credential write failed."); return;
        }
        connectStoredWifi();
        Serial.println("Wi-Fi connecting; password is not printed.");
        return;
    }
    if (line == "initfs ERASE" || line == "watch off" ||
        line.rfind("watch ", 0) == 0) {
        if (scaleNet->paired() || scaleNet->pairing()) {
            Serial.println("Refused: unpair before destructive filesystem initialization.");
            return;
        }
        Serial.println(LittleFS.format() ? "LittleFS formatted by explicit operator request." : "LittleFS format failed.");
        return;
    }
    if (line == "forgetwifi") {
        if (!scaleStorage.erase("scale_wifi")) { Serial.println("Wi-Fi erase failed."); return; }
        WiFi.disconnect(true);
        Serial.println("Wi-Fi credentials cleared.");
        return;
    }
    if (line == "netstatus") {
        Serial.printf("bowlWatch=%d\\n", bowlWatch);
        Serial.printf("device=%s wifi=%d clock=%d paired=%d pairing=%d blocked=%d pending=%u http=%d error=%s\n",
            deviceId().c_str(), WiFi.status() == WL_CONNECTED, scaleHttps.isOnline(),
            scaleNet->paired(), scaleNet->pairing(), scaleNet->blocked(),
            static_cast<unsigned>(scaleNet->pending()), scaleNet->lastStatus(),
            scaleNet->lastError().c_str());
        if (scaleNet->pairing()) Serial.printf("pair code: %s\n", scaleNet->pairCode().c_str());
        return;
    }
    if (line == "pair") {
        if (scaleNet->startPairing(millis()))
            Serial.printf("Pair code: %s (confirm in FeedMe2 web app)\n", scaleNet->pairCode().c_str());
        else Serial.println("Pair failed; check Wi-Fi, NTP, existing pairing and netstatus.");
        return;
    }
    if (line == "unpair") {
        disableBowlWatch("unpaired");
        Serial.println(scaleNet->unpair() ? "Unpaired. Previous queue is quarantined." : "NVS erase failed.");
        return;
    }
    if (line == "watch off") {
        disableBowlWatch("operator stopped");
        Serial.println("Automatic transition observation disabled.");
        return;
    }
    int absent = 0, present = 0;
    unsigned long long maxLift = 0;
    int consumed = 0;
    if (std::sscanf(line.c_str(), "watch %d %d %llu %n", &absent, &present, &maxLift, &consumed) == 3 &&
        consumed == static_cast<int>(line.size())) {
        const BowlDetectionConfig cfg{absent, present, maxLift, saved.maxGrossMg};
        if (!BowlLiftDetector(cfg).valid() || !samplingEnabled || !estimator ||
            !scaleNet->paired() || scaleNet->blocked() || !scaleOutbox.active()) {
            Serial.println("Watch refused: measured thresholds, stable sampling, valid calibration, pairing and queue required.");
            return;
        }
        bowlDetector.emplace(cfg);
        bowlWatch = true;
        Serial.println("Bowl watch enabled for this USB session only. Changes are review-only, not feedings.");
        return;
    }
    if (line == "record") {
        const uint64_t now = nowMs();
        struct timeval tv {};
        gettimeofday(&tv, nullptr);
        const int64_t utcMs = static_cast<int64_t>(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
        if (!samplingEnabled || !haveStable || now - stableAtMs > 2000 ||
            stableRevision != saved.revision ||
            utcMs < 1704067200000LL || utcMs > 4102444800000LL ||
            (lastRecordMs && now - lastRecordMs < 60000)) {
            Serial.println("No fresh stable measurement, synced clock, or 60s rate limit not met.");
            return;
        }
        if (scaleNet->enqueueStable(utcMs, stableRevision, stableGrossMg)) {
            lastRecordMs = now;
            Serial.printf("Queued stable grossMg=%ld; run sync to upload.\n", static_cast<long>(stableGrossMg));
        } else Serial.println("Enqueue refused; check pairing, queue and netstatus.");
        return;
    }
    if (line == "sync") {
        scaleNet->syncNow(millis());
        Serial.printf("Sync result: HTTP=%d pending=%u error=%s\n",
            scaleNet->lastStatus(), static_cast<unsigned>(scaleNet->pending()),
            scaleNet->lastError().c_str());
        return;
    }
}
#endif

void printStatus() {
    Serial.printf("scale bench: raw=%ld haveRaw=%d calibrated=%d pendingValid=%d revision=%lu run=%d\n",
        static_cast<long>(lastRaw), haveRaw, ScaleCalibration(saved).valid(),
        ScaleCalibration(pending).valid(), static_cast<unsigned long>(saved.revision), samplingEnabled);
    Serial.printf("pending zero=%ld reference=%ld referenceMg=%ld maxGrossMg=%ld\n",
        static_cast<long>(pending.zeroRaw), static_cast<long>(pending.referenceRaw),
        static_cast<long>(pending.referenceMg), static_cast<long>(pending.maxGrossMg));
}

void loadCalibration() {
    StoredCalibration record{};
    if (nvs.getBytesLength("points") != sizeof(record) ||
        nvs.getBytes("points", &record, sizeof(record)) != sizeof(record) ||
        record.magic != kMagic || record.checksum != checksum(record) ||
        !ScaleCalibration(record.config).valid()) {
        Serial.println("No valid persisted calibration. Raw-only mode.");
        return;
    }
    saved = pending = record.config;
    zeroCaptured = refCaptured = limitSet = true;
    Serial.printf("Loaded calibration revision=%lu\n", static_cast<unsigned long>(saved.revision));
}

void saveCalibration() {
    if (!zeroCaptured || !refCaptured || !limitSet) {
        Serial.println("Refused: capture zero, reference and software limit explicitly.");
        return;
    }
    if (saved.revision >= 2147483647u) {
        Serial.println("Revision exhausted; refuse calibration commit.");
        return;
    }
    Calibration candidate = pending;
    candidate.revision = saved.revision + 1;
    if (!ScaleCalibration(candidate).valid()) {
        Serial.println("Refused: set zero, ref <known-mg>, limit <validated-mg> first.");
        return;
    }
    StoredCalibration record{kMagic, candidate, 0};
    record.checksum = checksum(record);
    if (nvs.putBytes("points", &record, sizeof(record)) != sizeof(record)) {
        Serial.println("NVS write failed; calibration NOT committed.");
        return;
    }
    saved = pending = candidate;
#if defined(SCALE_NETWORK)
    disableBowlWatch("calibration changed");
#endif
    samplingEnabled = false;
    estimator.reset();
    Serial.printf("Calibration committed revision=%lu; sampling stopped.\n",
        static_cast<unsigned long>(saved.revision));
}

void process(const std::string& line) {
    if (line == "help") {
        Serial.println("status | zero | ref <mass_mg> | limit <max_gross_mg> | commit");
        Serial.println("tune <min_samples> <dwell_ms> <spread_mg> <max_gap_ms> | run | stop | clear");
#if defined(SCALE_NETWORK)
        Serial.println("wifi <ssid>|<WPA2-password> | forgetwifi | initfs ERASE | netstatus | pair | unpair | record | sync | watch <absent_mg> <present_mg> <max_lift_ms> | watch off");
#endif
        Serial.println("Commands zero/ref use the LAST RAW SAMPLE; verify no load/reference physically.");
        return;
    }
    if (line == "status") { printStatus(); return; }
    if (line == "zero") {
        if (!haveRaw || nowMs() - lastSampleMs > 1000) { Serial.println("No fresh ADC sample."); return; }
        pending.zeroRaw = lastRaw;
        zeroCaptured = true;
        refCaptured = false;
        pending.referenceRaw = 0;
        pending.referenceMg = 0;
        Serial.println("Pending zero recorded. Place a known reference mass, then ref <mg>.");
        return;
    }
    long long number = 0;
    int consumed = 0;
    if (std::sscanf(line.c_str(), "ref %lld %n", &number, &consumed) == 1 &&
        consumed == static_cast<int>(line.size()) && number > 0 && number <= 1000000) {
        if (!haveRaw || nowMs() - lastSampleMs > 1000) { Serial.println("No fresh ADC sample."); return; }
        if (!zeroCaptured) { Serial.println("Capture zero first."); return; }
        pending.referenceRaw = lastRaw;
        refCaptured = true;
        pending.referenceMg = static_cast<int32_t>(number);
        Serial.println("Pending reference recorded; set limit and commit.");
        return;
    }
    consumed = 0;
    if (std::sscanf(line.c_str(), "limit %lld %n", &number, &consumed) == 1 &&
        consumed == static_cast<int>(line.size()) && number > 0 && number <= 1000000) {
        pending.maxGrossMg = static_cast<int32_t>(number);
        limitSet = true;
        Serial.println("Pending software limit set (NOT a mechanical overload stop).");
        return;
    }
    if (line == "commit") { saveCalibration(); return; }
    if (line == "stop") {
#if defined(SCALE_NETWORK)
        disableBowlWatch("sampling stopped");
#endif
        samplingEnabled = false; estimator.reset(); Serial.println("Stopped."); return; }
    if (line == "clear") {
#if defined(SCALE_NETWORK)
        disableBowlWatch("calibration cleared");
#endif
        if (nvs.remove("points")) {
            saved = pending = Calibration{};
            zeroCaptured = refCaptured = limitSet = false;
            estimator.reset();
            samplingEnabled = false;
            Serial.println("Calibration cleared.");
        } else Serial.println("NVS remove failed.");
        return;
    }
    int n = 0, dwell = 0, spread = 0, gap = 0;
    consumed = 0;
    if (std::sscanf(line.c_str(), "tune %d %d %d %d %n", &n, &dwell, &spread, &gap, &consumed) == 4 &&
        consumed == static_cast<int>(line.size()) &&
        n >= 2 && n <= 256 && dwell >= 0 && gap >= 1) {
        const StabilityConfig candidate{static_cast<uint16_t>(n), static_cast<uint32_t>(dwell),
            spread, static_cast<uint32_t>(gap), pending.maxGrossMg};
        if (!WeightStabilityEstimator(candidate).valid()) {
            Serial.println("Invalid tuning. See StabilityConfig limits.");
            return;
        }
        tuning = candidate;
#if defined(SCALE_NETWORK)
        disableBowlWatch("stability tuning changed");
#endif
        estimator.emplace(tuning);
        samplingEnabled = false;
        Serial.println("Tuning accepted. Use run to observe stable windows.");
        return;
    }
    if (line == "run") {
        if (!ScaleCalibration(saved).valid() || !estimator ||
            tuning.maxGrossMg != saved.maxGrossMg) {
            Serial.println("Need committed calibration and matching tune first.");
            return;
        }
        estimator->reset();
#if defined(SCALE_NETWORK)
        disableBowlWatch("sampling restarted");
#endif
        samplingEnabled = true;
        Serial.println("Stable sampling enabled (serial-only; NO cloud events).");
        return;
    }
#if defined(SCALE_NETWORK)
    if (line.rfind("wifi ", 0) == 0 || line == "forgetwifi" || line == "netstatus" ||
        line == "pair" || line == "unpair" || line == "record" || line == "sync" ||
        line == "initfs ERASE") {
        networkCommand(line);
        return;
    }
#endif
    Serial.println("Unknown command; type help.");
}

void pollSerial() {
    while (Serial.available()) {
        const char ch = static_cast<char>(Serial.read());
        if (ch == '\r') continue;
        if (ch == '\n') {
            process(command);
            command.clear();
        } else if (command.size() < 120) command.push_back(ch);
        else command.clear();
    }
}

}  // namespace

void setup() {
    Serial.begin(115200);
    adc.begin();
    if (!nvs.begin("scale-cal", false)) Serial.println("NVS unavailable: calibration cannot persist.");
    loadCalibration();
    Serial.println("FeedMe2 XIAO HX711 USB bench. Type help. Do NOT use with pets.");
#if defined(SCALE_NETWORK)
    scaleNet.emplace(scaleHttps, scaleStorage, scaleRandom, scaleOutbox,
                     deviceId(), feedme2::application::kFirmwareVersion);
    if (!scaleNet->restore()) Serial.println("ERROR: pairing or queue storage corrupt; uploads disabled.");
    connectStoredWifi();
    Serial.println("Secure network bench enabled. Type netstatus; no automatic scale event recording.");
#endif
}

void loop() {
    pollSerial();
    const uint64_t now = nowMs();
    int32_t raw = 0;
    if (adc.readRaw(raw)) {
        haveRaw = true;
        lastRaw = raw;
        lastSampleMs = now;
        missingReported = false;
        if (now - lastPrintMs >= kRawPrintMs) {
            lastPrintMs = now;
            int32_t mg = 0;
            const auto code = ScaleCalibration(saved).convert(raw, mg);
            if (code == CalibrationStatus::Ok)
                Serial.printf("raw=%ld grossMg=%ld revision=%lu\n",
                    static_cast<long>(raw), static_cast<long>(mg),
                    static_cast<unsigned long>(saved.revision));
            else Serial.printf("raw=%ld calibrationStatus=%u\n",
                static_cast<long>(raw), static_cast<unsigned>(code));
        }
        if (samplingEnabled && estimator) {
            int32_t mg = 0;
            const auto status = ScaleCalibration(saved).convert(raw, mg);
            if (status != CalibrationStatus::Ok) {
                estimator->reset();
#if defined(SCALE_NETWORK)
                haveStable = false;
                disableBowlWatch("calibration/ADC fault");
#endif
                Serial.printf("FAULT calibrationStatus=%u\n", static_cast<unsigned>(status));
            } else {
                const auto r = estimator->add(WeightSample{now, mg, saved.revision});
#if defined(SCALE_NETWORK)
                haveStable = r.status == StabilityStatus::Stable;
                if (r.status == StabilityStatus::Fault) disableBowlWatch("stability estimator fault");
                if (haveStable) {
                    observeBowl(now, r.grossMg, r.calibrationRevision);
                    stableGrossMg = r.grossMg;
                    stableRevision = r.calibrationRevision;
                    stableAtMs = now;
                }
#endif
                if (r.status == StabilityStatus::Stable && now - lastStablePrintMs >= kStablePrintMs) {
                    lastStablePrintMs = now;
                    Serial.printf("STABLE grossMg=%ld spreadMg=%ld samples=%u\n",
                        static_cast<long>(r.grossMg), static_cast<long>(r.spreadMg), r.sampleCount);
                }
            }
        }
    } else if (haveRaw && now - lastSampleMs > kMissingMs && !missingReported) {
        missingReported = true;
        if (estimator) estimator->reset();
#if defined(SCALE_NETWORK)
        haveStable = false;
        disableBowlWatch("ADC timeout");
#endif
        Serial.println("FAULT adc_timeout: HX711 DOUT not ready");
    }
#if defined(SCALE_NETWORK)
    if (scaleNet) {
        scaleNet->tick(millis());
        if (bowlWatch && (!scaleNet->paired() || scaleNet->blocked() || !scaleOutbox.active()))
            disableBowlWatch("pairing revoked or queue unavailable");
        if (scaleNet->paired() != lastPaired) {
            lastPaired = scaleNet->paired();
            Serial.println(lastPaired ? "Pair confirmed; token stored (never printed)." : "Pairing lost; old queue retained.");
        }
    }
#endif
    delay(2);
}
