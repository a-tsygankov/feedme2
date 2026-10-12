#pragma once
#include <cstdint>
#include <vector>

namespace feedme2::domain {

enum class ScreenId : uint8_t { Boot, Pair, Idle, Amount, Fed, History, System, WifiList, About, UnpairConfirm };

class Router {
public:
    ScreenId current() const { return stack_.back(); }
    void push(ScreenId s) { stack_.push_back(s); }
    bool pop() { if (stack_.size() <= 1) return false; stack_.pop_back(); return true; }
    void replaceRoot(ScreenId s) { stack_.assign(1, s); }
    bool atRoot() const { return stack_.size() == 1; }

private:
    std::vector<ScreenId> stack_{ScreenId::Boot};
};

inline const char* screenName(ScreenId s) {
    switch (s) {
        case ScreenId::Boot: return "boot"; case ScreenId::Pair: return "pair"; case ScreenId::Idle: return "idle";
        case ScreenId::Amount: return "amount"; case ScreenId::Fed: return "fed"; case ScreenId::History: return "history";
        case ScreenId::System: return "system"; case ScreenId::WifiList: return "wifi"; case ScreenId::About: return "about";
        case ScreenId::UnpairConfirm: return "unpair";
    }
    return "?";
}

}  // namespace feedme2::domain
