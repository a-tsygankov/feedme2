#pragma once

// Pure semver-style version compare — the C++ mirror of
// shared/src/compare-versions.ts. Per-segment numeric compare when
// both sides are digits; a non-numeric tail ("1.4.2-rc1") sorts BEFORE
// the bare numeric form; non-numeric segments compare ordinally
// (std::string::compare), never locale-aware. No Arduino includes:
// host-tested.

#include <cstdlib>
#include <string>
#include <vector>

namespace feedme2::domain {

/// Negative if a < b, 0 if equal, positive if a > b.
inline int compareVersions(const std::string& a, const std::string& b) {
    auto split = [](const std::string& s, std::vector<std::string>& out) {
        out.clear();
        std::string cur;
        for (char c : s) {
            if (c == '.') { out.push_back(cur); cur.clear(); }
            else cur.push_back(c);
        }
        out.push_back(cur);
    };
    auto isNumeric = [](const std::string& s) {
        if (s.empty()) return false;
        for (char c : s) if (c < '0' || c > '9') return false;
        return true;
    };

    std::vector<std::string> pa, pb;
    split(a, pa);
    split(b, pb);
    const size_t len = pa.size() > pb.size() ? pa.size() : pb.size();
    for (size_t i = 0; i < len; ++i) {
        const std::string sa = i < pa.size() ? pa[i] : std::string("0");
        const std::string sb = i < pb.size() ? pb[i] : std::string("0");
        const bool aNum = isNumeric(sa);
        const bool bNum = isNumeric(sb);
        if (aNum && bNum) {
            const long na = std::strtol(sa.c_str(), nullptr, 10);
            const long nb = std::strtol(sb.c_str(), nullptr, 10);
            if (na != nb) return na < nb ? -1 : 1;
        } else if (aNum != bNum) {
            return aNum ? 1 : -1;
        } else {
            const int cmp = sa.compare(sb);
            if (cmp != 0) return cmp < 0 ? -1 : 1;
        }
    }
    return 0;
}

}  // namespace feedme2::domain
