#pragma once
#include <algorithm>
#include <string>
#include <vector>
#include "domain/FeedFlow.h"

namespace feedme2::domain {

// Offline feedings waiting for a sync round (spec §1.2 step 6). Capped so
// a device that never reconnects cannot exhaust LittleFS; the oldest go first.
class FeedingQueue {
public:
    static constexpr size_t kCap = 200;
    void push(FeedingDraft d) { items_.push_back(std::move(d)); if (items_.size() > kCap) items_.erase(items_.begin(), items_.begin() + (items_.size() - kCap)); }
    size_t size() const { return items_.size(); }
    bool empty() const { return items_.empty(); }
    const std::vector<FeedingDraft>& items() const { return items_; }
    std::vector<FeedingDraft> head(size_t n) const { return {items_.begin(), items_.begin() + std::min(n, items_.size())}; }
    void removeIds(const std::vector<std::string>& ids) {
        items_.erase(std::remove_if(items_.begin(), items_.end(), [&](const FeedingDraft& d) { return std::find(ids.begin(), ids.end(), d.id) != ids.end(); }), items_.end());
    }
    void replace(std::vector<FeedingDraft> items) { items_ = std::move(items); }

private:
    std::vector<FeedingDraft> items_;
};

}  // namespace feedme2::domain
