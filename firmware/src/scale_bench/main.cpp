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
    samplingEnabled = false;
    estimator.reset();
    Serial.printf("Calibration committed revision=%lu; sampling stopped.\n",
        static_cast<unsigned long>(saved.revision));
}

void process(const std::string& line) {
    if (line == "help") {
        Serial.println("status | zero | ref <mass_mg> | limit <max_gross_mg> | commit");
        Serial.println("tune <min_samples> <dwell_ms> <spread_mg> <max_gap_ms> | run | stop | clear");
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
    if (line == "stop") { samplingEnabled = false; estimator.reset(); Serial.println("Stopped."); return; }
    if (line == "clear") {
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
        samplingEnabled = true;
        Serial.println("Stable sampling enabled (serial-only; NO cloud events).");
        return;
    }
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
                Serial.printf("FAULT calibrationStatus=%u\n", static_cast<unsigned>(status));
            } else {
                const auto r = estimator->add(WeightSample{now, mg, saved.revision});
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
        Serial.println("FAULT adc_timeout: HX711 DOUT not ready");
    }
    delay(2);
}
