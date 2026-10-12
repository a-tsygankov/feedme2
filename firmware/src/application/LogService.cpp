#include "application/LogService.h"
#include <string>
#include <utility>
#include "application/QueueCodec.h"

namespace feedme2::application {

namespace {
// Cuts at the cap without splitting a UTF-8 sequence: a half character would make the line
// unparseable on the server and drop the whole batch.
std::string clampMsg(const char* msg) {
    std::string s(msg ? msg : "");
    if (s.size() <= LogService::kMaxMsgChars) return s;
    size_t cut = LogService::kMaxMsgChars;
    while (cut > 0 && (static_cast<unsigned char>(s[cut]) & 0xC0) == 0x80) --cut;
    s.resize(cut);
    return s;
}
// ArduinoJson re-serializes data minified, so a string that fits raw also fits on the server.
const char* clampData(const char* dataJson) {
    if (dataJson && std::char_traits<char>::length(dataJson) > LogService::kMaxDataBytes) return nullptr;
    return dataJson;
}
}  // namespace

LogService::LogService(ports::ILogSink& serial, ports::IFileQueue& files, ports::IClock& clock, domain::ClockModel& model)
    : serial_(serial), files_(files), clock_(clock), model_(model) {}

int64_t LogService::nowMs() {
    model_.setMonotonic(clock_.monotonicMs());
    return model_.nowMs();
}

void LogService::log(const char* level, const char* msg, const char* dataJson) {
    const std::string m = clampMsg(msg);
    const char* data = clampData(dataJson);
    serial_.write(level, m.c_str(), data);
    push(encodeLogEntry(nowMs(), level, m.c_str(), data));
}

void LogService::event(const char* name, const char* kv) {
    std::string line = std::string(name) + " " + (kv ? kv : "");
    const std::string m = clampMsg(line.c_str());
    serial_.write("info", ("[feedme2] " + m).c_str(), nullptr);
    push(encodeLogEntry(nowMs(), "info", m.c_str(), nullptr));
}

void LogService::push(std::string line) {
    pending_.push_back(std::move(line));
    while (pending_.size() > kCap) pending_.pop_front();
    files_.appendLine(kFile, pending_.back());
    ++diskLines_;
    // The file is compacted lazily: rewriting 300 lines on every log past the cap would wear
    // LittleFS on a device stuck offline, and loadFromDisk() keeps only the newest kCap anyway.
    if (diskLines_ > 2 * kCap) persist();
}

void LogService::persist() {
    files_.rewrite(kFile, std::vector<std::string>(pending_.begin(), pending_.end()));
    diskLines_ = pending_.size();
}

std::vector<std::string> LogService::takeBatch(size_t max) {
    const size_t n = pending_.size() < max ? pending_.size() : max;
    std::vector<std::string> out(pending_.begin(), pending_.begin() + n);
    pending_.erase(pending_.begin(), pending_.begin() + n);
    persist();
    return out;
}

void LogService::requeue(std::vector<std::string> lines) {
    pending_.insert(pending_.begin(), lines.begin(), lines.end());
    while (pending_.size() > kCap) pending_.pop_front();
    persist();
}

void LogService::loadFromDisk() {
    std::vector<std::string> lines;
    if (!files_.readLines(kFile, lines)) return;
    const size_t skip = lines.size() > kCap ? lines.size() - kCap : 0;
    pending_.assign(lines.begin() + skip, lines.end());
    diskLines_ = lines.size();
}

}  // namespace feedme2::application
