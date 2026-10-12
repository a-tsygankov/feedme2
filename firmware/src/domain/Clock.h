#pragma once
// Wall-clock model (spec §5.3): the device trusts the server's `now`
// over its RTC. Until the first sync, nowMs() is the monotonic counter
// so an unsynced timestamp is small and obviously wrong — the server
// clamps it (Phase 2a) and the UI shows "—" instead of "fed 56 years ago".
//
// millis() is 32-bit and wraps after 49.7 days; a device left on that long
// would otherwise see nowMs() jump back by 2^32 ms. The model keeps a 64-bit
// accumulator and treats "new raw < last raw" as one wrap (callers always
// pass the latest reading, so a smaller value can only mean it wrapped).
#include <cstdint>

namespace feedme2::domain {

class ClockModel {
public:
    void setMonotonic(uint32_t ms) { advance(ms); }
    void syncFromServer(int64_t serverNowMs, uint32_t monotonicMs) {
        advance(monotonicMs);
        offsetMs_ = serverNowMs - static_cast<int64_t>(monotonicMs_);
        synced_ = true;
    }
    bool isSynced() const { return synced_; }
    int64_t offsetMs() const { return offsetMs_; }
    int64_t nowMs() const { return synced_ ? offsetMs_ + static_cast<int64_t>(monotonicMs_) : static_cast<int64_t>(monotonicMs_); }

private:
    void advance(uint32_t raw) {
        if (raw < lastRawMs_) wraps_ += 1;
        lastRawMs_ = raw;
        monotonicMs_ = (static_cast<uint64_t>(wraps_) << 32) | raw;
    }

    uint64_t monotonicMs_ = 0;
    uint32_t lastRawMs_ = 0;
    uint32_t wraps_ = 0;
    int64_t offsetMs_ = 0;
    bool synced_ = false;
};

}  // namespace feedme2::domain
