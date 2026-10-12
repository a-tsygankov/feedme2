#pragma once
#include <cstddef>
#include <cstdint>
#include <deque>
#include <string>
#include <vector>
#include "application/LogService.h"
#include "domain/Clock.h"
#include "domain/FeedFlow.h"
#include "domain/FeedingQueue.h"
#include "ports/IFileQueue.h"
#include "ports/IRandom.h"

namespace feedme2::application {

// Confirmed feedings on their way to the server (spec §1.2 step 6). Each one is appended to
// /feedings.jsonl before commit() returns, so a feeding logged while Wi-Fi is down survives a
// reboot; only the ids the server `accepted` leave the file (Review Focus 2).
class FeedingService {
public:
    static constexpr const char* kFile = "/feedings.jsonl";
    static constexpr size_t kRecent = 5;

    FeedingService(ports::IFileQueue& files, ports::IRandom& random, domain::ClockModel& model, LogService& log);

    void loadFromDisk();
    std::vector<domain::FeedingDraft> commit(domain::FeedFlow& flow, int64_t nowMs);
    const domain::FeedingQueue& queue() const { return queue_; }
    std::vector<domain::FeedingDraft> headBatch(size_t n = 20) const { return queue_.head(n); }
    void markAccepted(const std::vector<std::string>& ids);
    // Newest first; feeds the History overlay (Task 10) together with the state's lastFedAt.
    std::vector<domain::FeedingDraft> recent(size_t n = kRecent) const;

private:
    void persist();

    ports::IFileQueue& files_;
    ports::IRandom& random_;
    // Not read yet: commit() takes nowMs from the caller, which has just refreshed the model from
    // the clock, so the drafts and the `feeding queued` line share one stamp. This service has no
    // clock port, so stamping from model_ here could reuse a monotonic value from a previous tick.
    // The reference stays so the constructor matches the plan's Task 6 contract and the App wiring.
    domain::ClockModel& model_;
    LogService& log_;
    domain::FeedingQueue queue_;
    std::deque<domain::FeedingDraft> recent_;
};

}  // namespace feedme2::application
