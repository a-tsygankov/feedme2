#pragma once
#include <cstddef>
#include <deque>
#include <string>
#include <vector>
#include "domain/Clock.h"
#include "ports/IClock.h"
#include "ports/IFileQueue.h"
#include "ports/ILogSink.h"

namespace feedme2::application {

// Device log (spec §5.7): every line goes to the serial sink at once and into an upload
// queue mirrored to /logs.jsonl so a reboot before the next sync round loses nothing.
// `event()` is the machine-readable "[feedme2] <name> <kv>" line the Wokwi scenarios assert.
class LogService {
public:
    static constexpr size_t kCap = 300;
    static constexpr const char* kFile = "/logs.jsonl";
    // LogEntrySchema caps msg at 500 chars; a longer one would 400 the whole batch as Permanent.
    static constexpr size_t kMaxMsgChars = 500;
    // LogsUploadBodySchema refines data to 1 KB serialized; an oversize data is dropped, not the line.
    static constexpr size_t kMaxDataBytes = 1024;

    LogService(ports::ILogSink& serial, ports::IFileQueue& files, ports::IClock& clock, domain::ClockModel& model);

    void info(const char* msg, const char* dataJson = nullptr) { log("info", msg, dataJson); }
    void warn(const char* msg, const char* dataJson = nullptr) { log("warn", msg, dataJson); }
    void error(const char* msg, const char* dataJson = nullptr) { log("error", msg, dataJson); }
    void event(const char* name, const char* kv);

    size_t pending() const { return pending_.size(); }
    // Oldest lines first; they leave the queue and the file, so a failed upload must requeue() them.
    std::vector<std::string> takeBatch(size_t max = 50);
    void requeue(std::vector<std::string> lines);
    void loadFromDisk();

private:
    void log(const char* level, const char* msg, const char* dataJson);
    void push(std::string line);
    void persist();
    int64_t nowMs();

    ports::ILogSink& serial_;
    ports::IFileQueue& files_;
    ports::IClock& clock_;
    domain::ClockModel& model_;
    std::deque<std::string> pending_;
    size_t diskLines_ = 0;
};

}  // namespace feedme2::application
