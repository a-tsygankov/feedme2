#pragma once

#include <string>
#include <vector>

#include "ports/IFileQueue.h"

namespace feedme2::adapters {

// JSONL queues on the LittleFS partition (`board_build.filesystem = littlefs`).
// The feeding queue is persisted on every write so a feeding logged while
// Wi-Fi is down survives a reboot and is sent later (Review Focus 2).
class LittleFsQueue final : public ports::IFileQueue {
public:
    explicit LittleFsQueue(bool formatOnFail = true) : formatOnFail_(formatOnFail) {}
    bool appendLine(const char* file, const std::string& line) override;
    bool readLines(const char* file, std::vector<std::string>& out) override;
    // Writes a temp file and renames it over the original so a power cut
    // mid-rewrite leaves either the old queue or the new one, never a torn file.
    bool rewrite(const char* file, const std::vector<std::string>& lines) override;
    bool hasCompleteRecords(const char* file) override;

private:
    bool mounted_ = false;
    bool mount();
};

}  // namespace feedme2::adapters
