#include "application/App.h"
#include <algorithm>
#include <cstdio>
#include <string>
#include <utility>

namespace feedme2::application {

using domain::ScreenId;

namespace {
// Touch swipes are the knob's rotations (spec §5.2); the grammar below only knows rotations.
int rotationOf(InputEvent ev) {
    switch (ev) {
        case InputEvent::RotateCW: case InputEvent::SwipeRight: return 1;
        case InputEvent::RotateCCW: case InputEvent::SwipeLeft: return -1;
        default: return 0;
    }
}
bool isBack(InputEvent ev) { return ev == InputEvent::DoubleTap || ev == InputEvent::LongPress; }
}  // namespace

App::App(AppDeps d)
    : clock_(d.clock), input_(d.input), fwVersion_(d.fwVersion ? d.fwVersion : "0.0.0"),
      log_(d.serial, d.files, d.clock, model_),
      feedings_(d.files, d.random, model_, log_),
      pair_(d.network, d.storage, d.clock, d.random, log_, d.deviceId, d.hwModel, fwVersion_),
      sync_(d.network, d.storage, d.clock, model_, feedings_, log_, pair_),
      power_(d.power, d.clock, log_) {}

void App::begin() {
    nowMs_ = clock_.monotonicMs();
    model_.setMonotonic(nowMs_);
    log_.loadFromDisk();
    feedings_.loadFromDisk();
    sync_.loadCachedState();
    applyState();
    const bool paired = pair_.isPaired();
    char kv[96];
    std::snprintf(kv, sizeof kv, "fw=%s paired=%d cats=%u", fwVersion_, paired ? 1 : 0,
                  static_cast<unsigned>(roster_.cats().size()));
    log_.event("boot ok", kv);
    router_.replaceRoot(paired ? ScreenId::Idle : ScreenId::Pair);
    afterTick();
    // The network may not be up yet (Wi-Fi joins in the background, spec §5.3): the round waits in
    // SyncService until it is, and pairing retries on its own timers.
    if (paired) sync_.requestRound("boot");
    else pair_.start();
    afterTick();
}

void App::tick(uint32_t nowMs) {
    nowMs_ = nowMs;
    model_.setMonotonic(nowMs);
    const bool held = input_.isHeld();
    power_.setHeld(held);
    power_.holdAwake(sync_.roundRequested() || !feedings_.queue().empty());
    power_.tick(nowMs);
    arc_.update(nowMs, held);

    const InputEvent ev = input_.poll();
    if (ev != InputEvent::None) {
        power_.noteInput(nowMs);
        // Only a real event may consume the wake flag: it is raised when the knob goes down (held)
        // and the Press itself arrives after the long-press window. Consuming it on an empty poll
        // would let that Press feed a cat at a screen that was dark a moment ago (Review Focus 1).
        if (power_.consumeWakeEvent()) sync_.requestRound("wake");
        else dispatch(ev, nowMs);
    }
    if (power_.timerWakeDue(nowMs)) sync_.requestRound("timer");

    if (router_.current() == ScreenId::Fed && nowMs - fedSinceMs_ >= kFedMs) {
        flow_.finishFed();
        router_.pop();
    }
    if (router_.current() == ScreenId::Pair) {
        pair_.tick(nowMs);
        if (pair_.view().phase == PairPhase::Confirmed) {
            router_.replaceRoot(ScreenId::Idle);
            sync_.requestRound("paired");
        }
    }
    // The screen line goes out before the round that the input (or the pairing) just requested:
    // with the network up the round runs synchronously inside sync_.tick(), and wokwi-cli's
    // wait-serial streams lines without rescanning, so "sync ok" printed ahead of "screen=fed"
    // (or "screen=idle" after pairing) hung the feed and boot scenarios.
    flushScreenChange();
    sync_.tick(nowMs);
    // A 401 on any device call cleared the token (Review Focus 3); the unpaired device must show
    // the Pair screen and start a new pairing, wherever the knob was.
    if (!pair_.isPaired() && router_.current() != ScreenId::Pair) goToPair();
    afterTick();
}

void App::flushScreenChange() {
    if (router_.current() == lastScreen_) return;
    log_.event(("screen=" + std::string(screenName(router_.current()))).c_str(),
               ("from=" + std::string(screenName(lastScreen_))).c_str());
    lastScreen_ = router_.current();
    if (lastScreen_ == ScreenId::Idle) printIdle();
}

void App::afterTick() {
    if (sync_.generation() != seenGeneration_) {
        applyState();
        if (router_.current() == ScreenId::Idle && lastScreen_ == ScreenId::Idle) printIdle();
    }
    flushScreenChange();
    const uint64_t fp = fingerprint();
    if (fp != lastFingerprint_) { lastFingerprint_ = fp; ++uiGeneration_; }
}

void App::applyState() {
    seenGeneration_ = sync_.generation();
    stateAtMs_ = nowMs_;
    // After a 401 the service holds an empty state: the roster empties with it and Idle shows
    // "no cats" until the next 200, the same path as a first boot before any state.
    roster_.setState(sync_.state());
    if (sync_.hasState()) {
        power_.setSleepTimeoutSec(sync_.state().settings.sleepTimeoutSec);
        power_.setSyncIntervalSec(sync_.state().settings.syncIntervalSec);
    }
    if (historyOffset_ >= static_cast<int>(historyEntries().size())) historyOffset_ = 0;
}

void App::goToPair() {
    router_.replaceRoot(ScreenId::Pair);
    flow_.cancel();
    // "screen=pair" goes out before "pair start code=…": the Wokwi pair scenario waits for them in that order.
    afterTick();
    pair_.start();
}

// ── Input grammar (spec §5.2) ───────────────────────────────────────────────────────────────────

void App::dispatch(InputEvent ev, uint32_t nowMs) {
    switch (router_.current()) {
        case ScreenId::Boot:
            return;
        case ScreenId::Pair:
            // Press retries; while the code is live a new start would void the one being typed.
            if (ev == InputEvent::Press) {
                const PairPhase p = pair_.view().phase;
                if (p != PairPhase::Pending && p != PairPhase::Starting && p != PairPhase::Confirmed) pair_.start();
            }
            return;
        case ScreenId::Idle:
            onIdle(ev);
            return;
        case ScreenId::Amount:
            onAmount(ev, nowMs);
            return;
        case ScreenId::Fed:
            if (ev == InputEvent::Press || isBack(ev)) { flow_.finishFed(); router_.pop(); }
            return;
        case ScreenId::History: {
            const int delta = rotationOf(ev);
            if (delta != 0) {
                const int n = static_cast<int>(historyEntries().size());
                historyOffset_ = std::max(0, std::min(historyOffset_ + delta, std::max(0, n - 1)));
            } else if (ev == InputEvent::Press || isBack(ev)) {
                router_.pop();
            }
            return;
        }
        case ScreenId::System:
            onSystem(ev, nowMs);
            return;
        case ScreenId::WifiList:
            // Press (connect / open the portal) needs the Wi-Fi adapter: the screen handles it.
            if (isBack(ev)) router_.pop();
            return;
        case ScreenId::About:
            if (isBack(ev)) router_.pop();
            return;
        case ScreenId::UnpairConfirm:
            if (ev == InputEvent::LongPress) {
                pair_.clearToken();
                log_.event("unpaired", "by=menu");
                goToPair();
            } else if (ev == InputEvent::DoubleTap) {
                router_.pop();
            }
            return;
    }
}

void App::onIdle(InputEvent ev) {
    const int delta = rotationOf(ev);
    if (delta != 0) {
        if (roster_.count() == 0) return;
        roster_.rotate(delta);
        printIdle();
        return;
    }
    switch (ev) {
        case InputEvent::Press:
            if (!sync_.hasState() || roster_.count() == 0) return;   // nothing to feed yet
            flow_.begin(sync_.state(), roster_.selected(), model_.nowMs());
            router_.push(ScreenId::Amount);
            return;
        case InputEvent::LongPress:
            menuIndex_ = 0;
            router_.push(ScreenId::System);
            return;
        case InputEvent::DoubleTap:
            historyOffset_ = 0;
            router_.push(ScreenId::History);
            return;
        default:
            return;
    }
}

void App::onAmount(InputEvent ev, uint32_t nowMs) {
    const int delta = rotationOf(ev);
    if (delta != 0) {
        flow_.rotate(delta);
        printAmount();
        return;
    }
    if (ev == InputEvent::Press) {
        // model_.nowMs() is monotonic until the first server answer; the server clamps such a stamp
        // to its own now (FeedFlow::draft), which is nearer the truth than an old snapshot plus uptime.
        const auto drafts = feedings_.commit(flow_, model_.nowMs());
        fed_ = FedSummary{};
        fed_.cats = static_cast<int>(drafts.size());
        for (const auto& d : drafts) fed_.amountMg += d.amountMg;
        fed_.label = flow_.isAll() ? std::to_string(drafts.size()) + " cats" : selectedCatName();
        char kv[96];
        std::snprintf(kv, sizeof kv, "cat=%s mg=%ld n=%d", flow_.isAll() ? "all" : selectedCatName().c_str(),
                      static_cast<long>(fed_.amountMg), fed_.cats);
        log_.event("fed", kv);
        router_.replaceRoot(ScreenId::Idle);
        router_.push(ScreenId::Fed);
        fedSinceMs_ = nowMs;
        sync_.requestRound("feeding");
        return;
    }
    if (isBack(ev)) {
        flow_.cancel();
        router_.pop();
    }
}

void App::onSystem(InputEvent ev, uint32_t nowMs) {
    const int delta = rotationOf(ev);
    if (delta != 0) {
        menuIndex_ = ((menuIndex_ + delta) % kMenuCount + kMenuCount) % kMenuCount;
        return;
    }
    if (ev == InputEvent::Press) openMenuItem(nowMs);
    else if (isBack(ev)) router_.pop();
}

void App::openMenuItem(uint32_t nowMs) {
    switch (menuIndex_) {
        case 0:
            router_.push(ScreenId::WifiList);
            return;
        case 1:
            if (pair_.isPaired()) router_.push(ScreenId::UnpairConfirm);
            else goToPair();
            return;
        case 2:
            router_.push(ScreenId::About);
            return;
        case 3:
            // "Sleep now": the PowerManager has no direct entry into LightSleep, so the last input is
            // backdated past the sleep threshold and its next tick walks Awake → Dim → LightSleep
            // (unless a round or a queued feeding holds it awake). The wake lands on Idle.
            router_.replaceRoot(ScreenId::Idle);
            power_.noteInput(nowMs - PowerManager::kSleepAfterMs);
            return;
        default:
            return;
    }
}

// ── Views for the screens ───────────────────────────────────────────────────────────────────────

const char* App::menuLabel(int index) const {
    switch (index) {
        case 0: return "Wi-Fi";
        case 1: return pair_.isPaired() ? "Unpair" : "Pair";
        case 2: return "About";
        case 3: return "Sleep now";
        default: return "";
    }
}

int64_t App::wallNowMs() const {
    if (model_.isSynced()) return model_.nowMs();
    if (sync_.hasState()) return sync_.state().nowMs + static_cast<int64_t>(nowMs_ - stateAtMs_);
    return model_.nowMs();
}

domain::HungerState App::hungerOf(const domain::CatState& cat) const {
    return domain::hungerState(wallNowMs(), cat.hasLastFed ? &cat.lastFedAtMs : nullptr, cat.hungryAfterSec);
}

domain::HungerLevel App::selectedLevel() const {
    if (const auto* c = roster_.selected()) return hungerOf(*c).level;
    domain::HungerLevel worst = domain::HungerLevel::Fed;
    for (const auto& c : roster_.cats()) worst = std::max(worst, hungerOf(c).level);
    return worst;
}

std::string App::selectedCatName() const {
    if (roster_.count() == 0) return kNoCat;
    if (roster_.isAllSelected()) return "all";
    const auto* c = roster_.selected();
    return c ? c->name : std::string(kNoCat);
}

std::vector<HistoryEntry> App::historyEntries() const {
    std::vector<HistoryEntry> out;
    for (const auto& d : feedings_.recent()) {
        HistoryEntry e;
        e.catName = kNoCat;
        for (const auto& c : roster_.cats()) if (c.id == d.catId) { e.catName = c.name; break; }
        e.amountMg = d.amountMg;
        e.amountKnown = true;
        e.fedAtMs = d.fedAtMs;
        out.push_back(std::move(e));
    }
    if (!out.empty()) return out;
    // Nothing logged here since boot: show what the server knows, newest first.
    for (const auto& c : roster_.cats()) {
        if (!c.hasLastFed) continue;
        HistoryEntry e;
        e.catName = c.name;
        e.fedAtMs = c.lastFedAtMs;
        out.push_back(std::move(e));
    }
    std::stable_sort(out.begin(), out.end(), [](const HistoryEntry& a, const HistoryEntry& b) { return a.fedAtMs > b.fedAtMs; });
    if (out.size() > FeedingService::kRecent) out.resize(FeedingService::kRecent);
    return out;
}

// ── Serial event lines (spec §5.7) ──────────────────────────────────────────────────────────────

void App::printIdle() {
    const std::string name = selectedCatName();
    const std::string level = roster_.count() == 0 ? kNoCat : domain::levelName(selectedLevel());
    log_.event("idle", ("cat=" + name + " level=" + level).c_str());
}

void App::printAmount() {
    char kv[128];
    std::snprintf(kv, sizeof kv, "cat=%s mg=%ld text=%s", flow_.isAll() ? "all" : selectedCatName().c_str(),
                  static_cast<long>(flow_.amountMg()), flow_.amountText().c_str());
    log_.event("amount", kv);
}

uint64_t App::fingerprint() const {
    // A cheap change detector for uiGeneration(): mixes every value the screens render from.
    uint64_t h = 1469598103934665603ull;
    auto mix = [&h](uint64_t v) { h ^= v + 0x9e3779b97f4a7c15ull + (h << 6) + (h >> 2); };
    mix(static_cast<uint64_t>(router_.current()));
    mix(roster_.index());
    mix(roster_.count());
    mix(static_cast<uint64_t>(flow_.phase()));
    mix(static_cast<uint64_t>(static_cast<int64_t>(flow_.amountMg())));
    mix(static_cast<uint64_t>(flow_.scale()));
    mix(sync_.generation());
    mix(static_cast<uint64_t>(power_.tier()));
    mix(static_cast<uint64_t>(menuIndex_));
    mix(static_cast<uint64_t>(historyOffset_));
    mix(static_cast<uint64_t>(pair_.view().phase));
    for (const char c : pair_.view().pairCode) mix(static_cast<uint64_t>(static_cast<unsigned char>(c)));
    mix(model_.isSynced() ? 1 : 0);
    mix(sync_.lastRoundOk() ? 1 : 0);
    mix(feedings_.queue().size());
    // Time-derived state changes with no input: Idle's hunger level crosses its thresholds on its
    // own, and History's "N min ago" ages tick over once a minute. Without these a screen that
    // redraws only on uiGeneration() showed a stale level until the knob moved.
    mix(static_cast<uint64_t>(selectedLevel()));
    mix(static_cast<uint64_t>(wallNowMs() / 60000));
    return h;
}

}  // namespace feedme2::application
