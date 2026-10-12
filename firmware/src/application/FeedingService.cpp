#include "application/FeedingService.h"
#include <cstdio>
#include "application/QueueCodec.h"

namespace feedme2::application {

FeedingService::FeedingService(ports::IFileQueue& files, ports::IRandom& random, domain::ClockModel& model, LogService& log)
    : files_(files), random_(random), model_(model), log_(log) {}

void FeedingService::loadFromDisk() {
    std::vector<std::string> lines;
    if (!files_.readLines(kFile, lines)) return;
    std::vector<domain::FeedingDraft> items;
    for (const auto& line : lines) {
        domain::FeedingDraft d;
        if (decodeDraft(line, d)) items.push_back(std::move(d));
        else log_.warn("feedings.jsonl: skipped malformed line");
    }
    queue_.replace(std::move(items));
}

std::vector<domain::FeedingDraft> FeedingService::commit(domain::FeedFlow& flow, int64_t nowMs) {
    (void)model_;  // the caller passes the ClockModel's nowMs so the drafts and the event share one stamp
    auto drafts = flow.confirm([&] { return random_.uuid(); }, nowMs);
    for (const auto& d : drafts) {
        const bool atCap = queue_.size() >= domain::FeedingQueue::kCap;
        queue_.push(d);
        // Past the cap the queue dropped its oldest, so the file must shrink with it.
        if (atCap) persist(); else files_.appendLine(kFile, encodeDraft(d));
        char kv[160];
        std::snprintf(kv, sizeof kv, "id=%s cat=%s mg=%ld", d.id.c_str(), d.catId.c_str(), static_cast<long>(d.amountMg));
        log_.event("feeding queued", kv);
        recent_.push_front(d);
        while (recent_.size() > kRecent) recent_.pop_back();
    }
    return drafts;
}

void FeedingService::markAccepted(const std::vector<std::string>& ids) {
    if (ids.empty()) return;
    queue_.removeIds(ids);
    persist();
}

std::vector<domain::FeedingDraft> FeedingService::recent(size_t n) const {
    const size_t count = recent_.size() < n ? recent_.size() : n;
    return {recent_.begin(), recent_.begin() + count};
}

void FeedingService::persist() {
    std::vector<std::string> lines;
    lines.reserve(queue_.size());
    for (const auto& d : queue_.items()) lines.push_back(encodeDraft(d));
    files_.rewrite(kFile, lines);
}

}  // namespace feedme2::application
