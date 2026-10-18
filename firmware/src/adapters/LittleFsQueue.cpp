#include "adapters/LittleFsQueue.h"

#include <Arduino.h>
#include <LittleFS.h>

namespace feedme2::adapters {

bool LittleFsQueue::mount() {
    if (mounted_) return true;
    // formatOnFail: a blank or corrupt partition becomes an empty queue rather
    // than a device that can never log a feeding again.
    mounted_ = LittleFS.begin(/*formatOnFail=*/true);
    if (!mounted_) Serial.println("[feedme2] littlefs mount failed");
    return mounted_;
}

bool LittleFsQueue::appendLine(const char* file, const std::string& line) {
    if (!mount()) return false;
    File f = LittleFS.open(file, FILE_APPEND);
    if (!f) return false;
    // One write for line + '\n'. Two writes (line, then newline) leave a
    // window where a power cut strands a line without its terminator; the
    // next append then glues its JSON onto that line and readLines drops
    // both feedings as one unparseable record. A single write either lands
    // whole or is the trailing partial that readLines already discards.
    const std::string record = line + '\n';
    const size_t wrote = f.write(reinterpret_cast<const uint8_t*>(record.data()), record.size());
    f.close();
    return wrote == record.size();
}

bool LittleFsQueue::readLines(const char* file, std::vector<std::string>& out) {
    if (!mount()) return false;
    if (!LittleFS.exists(file)) return true;  // no file yet means an empty queue
    File f = LittleFS.open(file, FILE_READ);
    if (!f) return false;
    std::string current;
    while (f.available() > 0) {
        const int c = f.read();
        if (c < 0) break;
        if (c == '\n') {
            if (!current.empty()) out.push_back(current);
            current.clear();
        } else if (c != '\r') {
            current.push_back(static_cast<char>(c));
        }
    }
    f.close();
    // A trailing partial line (power cut mid-append) is dropped: it is not
    // valid JSON and the feeding was never acknowledged to the person anyway.
    return true;
}

bool LittleFsQueue::rewrite(const char* file, const std::vector<std::string>& lines) {
    if (!mount()) return false;
    const std::string tmp = std::string(file) + ".tmp";
    {
        File f = LittleFS.open(tmp.c_str(), FILE_WRITE);
        if (!f) return false;
        for (const auto& line : lines) {
            if (f.write(reinterpret_cast<const uint8_t*>(line.data()), line.size()) != line.size() ||
                f.write('\n') != 1) {
                f.close();
                LittleFS.remove(tmp.c_str());
                return false;
            }
        }
        f.close();
    }
    // lfs_rename replaces an existing destination atomically.
    if (!LittleFS.rename(tmp.c_str(), file)) {
        LittleFS.remove(tmp.c_str());
        return false;
    }
    return true;
}


bool LittleFsQueue::hasCompleteRecords(const char* file) {
    if (!mount()) return false;
    if (!LittleFS.exists(file)) return true;
    File f = LittleFS.open(file, FILE_READ);
    if (!f) return false;
    const size_t n = f.size();
    if (n == 0) { f.close(); return true; }
    if (!f.seek(n - 1)) { f.close(); return false; }
    const int last = f.read();
    f.close();
    // A trailing incomplete JSON record must not be silently dropped by
    // readLines(), then glued to the next append after a power interruption.
    return last == '\n';
}

}  // namespace feedme2::adapters
