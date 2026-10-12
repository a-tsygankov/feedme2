#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include "application/Events.h"
#include "application/FeedingService.h"
#include "application/LogService.h"
#include "application/PairCoordinator.h"
#include "application/PowerManager.h"
#include "application/SyncService.h"
#include "domain/CatRoster.h"
#include "domain/Clock.h"
#include "domain/DeviceState.h"
#include "domain/FeedFlow.h"
#include "domain/Hunger.h"
#include "domain/LongPressArc.h"
#include "domain/Router.h"
#include "ports/IClock.h"
#include "ports/IFileQueue.h"
#include "ports/IInput.h"
#include "ports/ILogSink.h"
#include "ports/INetwork.h"
#include "ports/IPower.h"
#include "ports/IRandom.h"
#include "ports/IStorage.h"

namespace feedme2::application {

// Everything the App needs from the outside world. main.cpp fills it with the ESP adapters (or
// the simulator fakes); the native tests with stubs.
struct AppDeps {
    ports::IClock& clock;
    ports::IRandom& random;
    ports::IInput& input;
    ports::INetwork& network;
    ports::IStorage& storage;
    ports::IFileQueue& files;
    ports::IPower& power;
    ports::ILogSink& serial;
    std::string deviceId;
    std::string hwModel;
    const char* fwVersion;
};

// One row of the History overlay: a queued/recent feeding (amountKnown) or, when nothing was
// logged on this device since boot, a cat's lastFedAt from the server state (amount unknown).
struct HistoryEntry {
    std::string catName;
    int32_t amountMg = 0;
    bool amountKnown = false;
    int64_t fedAtMs = 0;
};

// What the Fed screen shows: "Logged 40 g for Mochi" or "Logged 80 g for 2 cats".
struct FedSummary {
    std::string label;      // cat name, or "N cats"
    int32_t amountMg = 0;   // total over the drafts
    int cats = 0;
};

// Wires the services together and owns the knob grammar (spec §5.2). Plain C++: the screens
// (LVGL, Task 14) read it through the accessors and never the other way round, so the same
// object runs under Unity with stub ports. tick() is the one entry point from loop().
class App {
public:
    static constexpr uint32_t kFedMs = 2000;
    static constexpr int kMenuCount = 4;   // Wi-Fi · Pair/Unpair · About · Sleep now
    static constexpr const char* kNoCat = "none";

    explicit App(AppDeps deps);

    // Loads the cached state, logs and queue, then lands on Idle (paired) or Pair (not), starting
    // the pairing or the boot sync round. Prints "[feedme2] boot ok fw=… paired=… cats=…".
    void begin();
    void tick(uint32_t nowMs);

    domain::Router& router() { return router_; }
    const domain::Router& router() const { return router_; }
    const domain::CatRoster& roster() const { return roster_; }
    const domain::FeedFlow& flow() const { return flow_; }
    const domain::LongPressArc& arc() const { return arc_; }
    SyncService& sync() { return sync_; }
    PairCoordinator& pair() { return pair_; }
    PowerManager& power() { return power_; }
    LogService& log() { return log_; }
    FeedingService& feedings() { return feedings_; }

    // Bumps on anything the screens must redraw: screen, selection, amount, state, power tier,
    // menu row, history row, pairing phase/code, clock sync. The arc is excluded (polled per frame).
    uint32_t uiGeneration() const { return uiGeneration_; }

    bool hasState() const { return sync_.hasState(); }
    const domain::DeviceState& state() const { return sync_.state(); }
    // Best wall-clock guess: the server's once it answered, else the cached snapshot's `now` plus
    // the uptime since it was loaded, else the monotonic counter (Review Focus 4).
    int64_t wallNowMs() const;
    bool clockSynced() const { return model_.isSynced(); }
    domain::HungerState hungerOf(const domain::CatState& cat) const;
    // The level Idle shows: the selected cat's, or the hungriest cat's for "All cats".
    domain::HungerLevel selectedLevel() const;
    // "Mochi", "all", or kNoCat when the house has no cats.
    std::string selectedCatName() const;

    int historyOffset() const { return historyOffset_; }
    std::vector<HistoryEntry> historyEntries() const;
    int menuIndex() const { return menuIndex_; }
    const char* menuLabel(int index) const;
    const FedSummary& fedSummary() const { return fed_; }

    // The captive portal is a request the person makes with a Press on the Wi-Fi screen, never a
    // side effect of opening it (review of 944eedc: an offline device rebooted into the portal
    // on every tick). main.cpp takes the flag, which empties it; nothing else here acts on it.
    bool portalRequested() const { return portalRequested_; }
    bool takePortalRequest() {
        const bool was = portalRequested_;
        portalRequested_ = false;
        return was;
    }

private:
    void dispatch(InputEvent ev, uint32_t nowMs);
    void onIdle(InputEvent ev);
    void onAmount(InputEvent ev, uint32_t nowMs);
    void onSystem(InputEvent ev, uint32_t nowMs);
    void openMenuItem(uint32_t nowMs);
    void goToPair();
    void applyState();
    void printIdle();
    void printAmount();
    // Prints "screen=<to> from=<from>" (and Idle's line) the moment the router differs from what
    // was last printed; called before a sync round can run so the scenarios see it first.
    void flushScreenChange();
    void afterTick();
    uint64_t fingerprint() const;

    ports::IClock& clock_;
    ports::IInput& input_;
    const char* fwVersion_;
    domain::ClockModel model_;
    LogService log_;
    FeedingService feedings_;
    PairCoordinator pair_;
    SyncService sync_;
    PowerManager power_;
    domain::Router router_;
    domain::CatRoster roster_;
    domain::FeedFlow flow_;
    domain::LongPressArc arc_;

    uint32_t nowMs_ = 0;
    uint32_t stateAtMs_ = 0;        // monotonic time the current state (cache or server) was applied
    uint32_t seenGeneration_ = 0;   // sync_.generation() already applied to the roster/power
    domain::ScreenId lastScreen_ = domain::ScreenId::Boot;
    uint32_t fedSinceMs_ = 0;
    int historyOffset_ = 0;
    int menuIndex_ = 0;
    bool portalRequested_ = false;
    FedSummary fed_;
    uint32_t uiGeneration_ = 0;
    uint64_t lastFingerprint_ = 0;
};

}  // namespace feedme2::application
