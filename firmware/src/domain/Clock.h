#pragma once
// Wall-clock model (spec §5.3): the device trusts the server's `now`
// over its RTC. Until the first sync, nowMs() is the monotonic counter
// so an unsynced timestamp is small and obviously wrong — the server
// clamps it (Phase 2a) and the UI shows "—" instead of "fed 56 years ago".
#include <cstdint>

namespace feedme2::domain {

class ClockModel {
public:
    void setMonotonic(uint32_t ms) { monotonicMs_ = ms; }
    void syncFromServer(int64_t serverNowMs, uint32_t monotonicMs) {
        monotonicMs_ = monotonicMs;
        offsetMs_ = serverNowMs - static_cast<int64_t>(monotonicMs);
        synced_ = true;
    }
    bool isSynced() const { return synced_; }
    int64_t offsetMs() const { return offsetMs_; }
    int64_t nowMs() const { return synced_ ? offsetMs_ + static_cast<int64_t>(monotonicMs_) : static_cast<int64_t>(monotonicMs_); }

private:
    uint32_t monotonicMs_ = 0;
    int64_t offsetMs_ = 0;
    bool synced_ = false;
};

}  // namespace feedme2::domain
