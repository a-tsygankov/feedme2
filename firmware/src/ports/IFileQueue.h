#pragma once
#include <string>
#include <vector>

namespace feedme2::ports {

// JSONL files on LittleFS: /feedings.jsonl and /logs.jsonl. One JSON object per line.
class IFileQueue {
public:
    virtual ~IFileQueue() = default;
    virtual bool appendLine(const char* file, const std::string& line) = 0;
    virtual bool readLines(const char* file, std::vector<std::string>& out) = 0;
    virtual bool rewrite(const char* file, const std::vector<std::string>& lines) = 0;
    // Optional strict-tail check for append-only safety-critical queues.\n    // Adapters not backed by a byte stream can keep the default.\n    virtual bool hasCompleteRecords(const char* file) { (void)file; return true; }
};

}  // namespace feedme2::ports
