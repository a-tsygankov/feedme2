#pragma once
// Knob selection over the cats plus the "All cats" entry (spec §1.2 step 2).
#include <algorithm>
#include <string>
#include "domain/DeviceState.h"

namespace feedme2::domain {

class CatRoster {
public:
    void setState(const DeviceState& s) {
        std::string keepId = selectedId();
        const bool keepAll = isAllSelected();
        cats_ = s.cats;
        std::stable_sort(cats_.begin(), cats_.end(), catOrderLess);
        index_ = 0;
        if (keepAll && hasAll()) index_ = cats_.size();
        else if (!keepId.empty()) selectById(keepId);
    }
    size_t count() const { return cats_.size() + (hasAll() ? 1 : 0); }
    bool hasAll() const { return cats_.size() >= 2; }
    void rotate(int delta) {
        const size_t n = count();
        if (n == 0) return;
        const long i = (static_cast<long>(index_) + delta) % static_cast<long>(n);
        index_ = static_cast<size_t>(i < 0 ? i + static_cast<long>(n) : i);
    }
    bool isAllSelected() const { return hasAll() && index_ == cats_.size(); }
    const CatState* selected() const { return (cats_.empty() || isAllSelected()) ? nullptr : &cats_[index_]; }
    size_t index() const { return index_; }
    void selectById(const std::string& id) {
        for (size_t i = 0; i < cats_.size(); ++i) if (cats_[i].id == id) { index_ = i; return; }
    }
    const std::vector<CatState>& cats() const { return cats_; }

private:
    std::string selectedId() const { const auto* c = selected(); return c ? c->id : std::string(); }
    std::vector<CatState> cats_;
    size_t index_ = 0;
};

}  // namespace feedme2::domain
