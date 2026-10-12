#pragma once
#include <cstdio>
#include <deque>
#include <map>
#include <string>
#include <vector>
#include "ports/IClock.h"
#include "ports/IFileQueue.h"
#include "ports/IInput.h"
#include "ports/ILogSink.h"
#include "ports/INetwork.h"
#include "ports/IPower.h"
#include "ports/IRandom.h"
#include "ports/IStorage.h"

namespace feedme2::test {
using namespace feedme2::ports;

struct StubClock : IClock { uint32_t ms = 0; uint32_t monotonicMs() override { return ms; } void advance(uint32_t d) { ms += d; } };
struct StubRandom : IRandom { int n = 0; std::string uuid() override { char b[40]; std::snprintf(b, sizeof b, "00000000-0000-4000-8000-%012d", ++n); return b; } uint32_t next() override { return static_cast<uint32_t>(++n); } std::string hex(size_t bytes) override { char b[8]; std::snprintf(b, sizeof b, "%02x", ++n & 0xff); std::string out; for (size_t i = 0; i < bytes; ++i) out += b; return out; } };
struct StubInput : IInput { std::deque<application::InputEvent> q; bool held = false; application::InputEvent poll() override { if (q.empty()) return application::InputEvent::None; auto e = q.front(); q.pop_front(); return e; } bool isHeld() const override { return held; } };
struct StubStorage : IStorage {
    std::map<std::string, std::string> kv; int writes = 0;
    bool read(const char* k, std::string& out) override { auto it = kv.find(k); if (it == kv.end()) return false; out = it->second; return true; }
    bool write(const char* k, const std::string& v) override { kv[k] = v; ++writes; return true; }
    bool erase(const char* k) override { return kv.erase(k) > 0; }
};
struct StubFileQueue : IFileQueue {
    std::map<std::string, std::vector<std::string>> files; int appends = 0, rewrites = 0;
    bool appendLine(const char* f, const std::string& l) override { files[f].push_back(l); ++appends; return true; }
    bool readLines(const char* f, std::vector<std::string>& out) override { out = files[f]; return true; }
    bool rewrite(const char* f, const std::vector<std::string>& lines) override { files[f] = lines; ++rewrites; return true; }
};
struct StubPower : IPower {
    int backlight = 100; bool displayAsleep = false; int lightSleeps = 0; uint32_t lastRgb = 0;
    void setBacklight(uint8_t p) override { backlight = p; }
    void displaySleep(bool on) override { displayAsleep = on; }
    void lightSleep(uint32_t) override { ++lightSleeps; }
    void ledRing(uint32_t rgb, uint8_t) override { lastRgb = rgb; }
};
struct StubLogSink : ILogSink { std::vector<std::string> lines; void write(const char* lvl, const char* msg, const char* data) override { lines.push_back(std::string(lvl) + " " + msg + (data ? std::string(" ") + data : "")); } };
struct StubNetwork : INetwork {
    bool online = true; std::string token;
    std::deque<NetResult> stateResults, feedingResults, logResults, heartbeatResults, pairStartResults, pairCheckResults;
    std::vector<std::string> postedFeedings, postedLogs, postedHeartbeats, ifNoneMatch;
    // The pairing bodies the device would POST, recorded so tests can pin the poll secret (Task 7).
    struct PairCall { std::string deviceId, hwModel, fw, pollSecret; };
    std::vector<PairCall> pairStarts, pairChecks;
    static NetResult ok(std::string body, std::string etag = "") { return NetResult::fromStatus(200, std::move(body), std::move(etag)); }
    static NetResult status(int s, std::string body = "") { return NetResult::fromStatus(s, std::move(body)); }
    NetResult take(std::deque<NetResult>& q) { if (q.empty()) return status(0); auto r = q.front(); q.pop_front(); return r; }
    bool isOnline() const override { return online; }
    void setToken(const std::string& t) override { token = t; }
    NetResult pairStart(const std::string& id, const std::string& hw, const std::string& fw, const std::string& secret) override { pairStarts.push_back({id, hw, fw, secret}); return take(pairStartResults); }
    NetResult pairCheck(const std::string& id, const std::string& secret) override { pairChecks.push_back({id, "", "", secret}); return take(pairCheckResults); }
    NetResult getState(const std::string& inm) override { ifNoneMatch.push_back(inm); return take(stateResults); }
    NetResult postFeedings(const std::string& j) override { postedFeedings.push_back(j); return take(feedingResults); }
    NetResult postLogs(const std::string& j) override { postedLogs.push_back(j); return take(logResults); }
    NetResult postHeartbeat(const std::string& j) override { postedHeartbeats.push_back(j); return take(heartbeatResults); }
};
}  // namespace feedme2::test
