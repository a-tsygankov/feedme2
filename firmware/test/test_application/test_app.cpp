#include <unity.h>
#include <memory>
#include <string>
#include "application/App.h"
#include "fixtures.h"
#include "stubs.h"
using namespace feedme2;
using application::InputEvent;
using application::PowerTier;
using domain::ScreenId;

namespace {
std::string sample() { return readFixture("device-state.sample.json"); }

// Every stub port plus the App, built the way main.cpp builds it. Tests start paired with the
// sample house cached (the common boot) unless they say otherwise. The network is offline by
// default so a requested round stays visible as roundRequested(); tests that want a round to run
// go online and queue the responses.
struct Rig {
    test::StubClock clk; test::StubRandom rnd; test::StubInput input; test::StubNetwork net; test::StubStorage store;
    test::StubFileQueue files; test::StubPower power; test::StubLogSink serial;
    std::unique_ptr<application::App> app;

    explicit Rig(bool paired = true, bool cached = true) {
        net.online = false;
        if (paired) store.kv["token"] = "tok";
        if (cached) { store.kv["state"] = sample(); store.kv["etag"] = "W/\"x\""; }
        app = std::make_unique<application::App>(application::AppDeps{clk, rnd, input, net, store, files, power, serial,
                                                                      "0123456789abcdef0123456789abcdef", "device-sim", "0.2.0"});
    }
    void push(InputEvent e) { input.q.push_back(e); }
    void tick(uint32_t ms) { clk.ms = ms; app->tick(ms); }
    void pushAndTick(InputEvent e, uint32_t ms) { push(e); tick(ms); }
    bool serialHas(const char* needle) const {
        for (const auto& l : serial.lines) if (l.find(needle) != std::string::npos) return true;
        return false;
    }
    size_t serialCount(const char* needle) const {
        size_t n = 0;
        for (const auto& l : serial.lines) if (l.find(needle) != std::string::npos) ++n;
        return n;
    }
    // Index of the first serial line holding `needle`, or -1.
    int serialIndex(const char* needle) const {
        for (size_t i = 0; i < serial.lines.size(); ++i) if (serial.lines[i].find(needle) != std::string::npos) return static_cast<int>(i);
        return -1;
    }
    // A full happy-path round: logs accepted, state 200, heartbeat answers with the sample's own `now`
    // so Mochi (fed an hour before it) reads "content".
    void pushHappyRound() {
        net.logResults.push_back(test::StubNetwork::status(202));
        net.stateResults.push_back(test::StubNetwork::ok(sample(), "W/\"abc\""));
        net.heartbeatResults.push_back(test::StubNetwork::ok("{\"now\":1700003600000}"));
    }
    ScreenId screen() const { return app->router().current(); }
};
}  // namespace

void test_app_boot_unpaired_shows_pair_and_starts_pairing() {
    Rig r(false, false);
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"424242\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.app->begin();
    TEST_ASSERT_EQUAL(ScreenId::Pair, r.screen());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] boot ok fw=0.2.0 paired=0 cats=0"));
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] screen=pair"));
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] pair start code=424242"));
    // The order the Wokwi boot scenario waits for.
    TEST_ASSERT_TRUE(r.serialIndex("boot ok") < r.serialIndex("screen=pair"));
    TEST_ASSERT_TRUE(r.serialIndex("screen=pair") < r.serialIndex("pair start"));
    TEST_ASSERT_EQUAL_UINT32(1, r.net.pairStarts.size());
    TEST_ASSERT_EQUAL_STRING("424242", r.app->pair().view().pairCode.c_str());
    TEST_ASSERT_FALSE(r.app->hasState());
    // Rotate does nothing on Pair; Press while the code is still live keeps it (a new start would
    // invalidate the code the person is typing).
    r.pushAndTick(InputEvent::RotateCW, 10);
    r.pushAndTick(InputEvent::Press, 20);
    TEST_ASSERT_EQUAL(ScreenId::Pair, r.screen());
    TEST_ASSERT_EQUAL_UINT32(1, r.net.pairStarts.size());
    // Expired: Press retries at once.
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"expired\"}"));
    r.tick(3100);
    TEST_ASSERT_EQUAL(application::PairPhase::Expired, r.app->pair().view().phase);
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"111111\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.pushAndTick(InputEvent::Press, 3200);
    TEST_ASSERT_EQUAL_UINT32(2, r.net.pairStarts.size());
    TEST_ASSERT_EQUAL_STRING("111111", r.app->pair().view().pairCode.c_str());
    // Confirmed: Idle, and a "paired" round runs as soon as the network answers.
    r.net.online = true;
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"confirmed\",\"deviceToken\":\"tok\",\"houseId\":\"h\",\"deviceName\":\"Kitchen\"}"));
    r.pushHappyRound();
    r.tick(6300);
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] paired house=h"));
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] screen=idle"));
    TEST_ASSERT_EQUAL_STRING("paired", r.app->sync().last().reason.c_str());
    TEST_ASSERT_TRUE(r.app->hasState());
    TEST_ASSERT_EQUAL_UINT32(3, r.app->roster().count());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] idle cat=Mochi level=content"));
    TEST_ASSERT_TRUE(r.app->clockSynced());
}

void test_app_boot_paired_with_cached_state_renders_idle_and_requests_sync() {
    Rig r;
    r.app->begin();
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] boot ok fw=0.2.0 paired=1 cats=2"));
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] screen=idle"));
    // The cached snapshot is an hour after Mochi's last feeding: content, from cache, before any network.
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] idle cat=Mochi level=content"));
    TEST_ASSERT_FALSE(r.app->clockSynced());
    TEST_ASSERT_TRUE(r.app->hasState());
    TEST_ASSERT_EQUAL_UINT32(3, r.app->roster().count());
    TEST_ASSERT_EQUAL_STRING("Mochi", r.app->roster().selected()->name.c_str());
    TEST_ASSERT_TRUE(r.app->sync().roundRequested());
    TEST_ASSERT_TRUE(r.net.pairStarts.empty());
    // Settings reached the power tiers.
    TEST_ASSERT_EQUAL_INT32(300, r.app->power().sleepTimeoutSec());
    TEST_ASSERT_EQUAL_INT32(21600, r.app->power().syncIntervalSec());
    // Nothing to redraw until something changes; a rotate is a change.
    const uint32_t gen = r.app->uiGeneration();
    r.tick(5);
    TEST_ASSERT_EQUAL_UINT32(gen, r.app->uiGeneration());
    r.pushAndTick(InputEvent::RotateCW, 10);
    TEST_ASSERT_TRUE(r.app->uiGeneration() > gen);
    TEST_ASSERT_EQUAL_STRING("Luna", r.app->roster().selected()->name.c_str());
    // Luna was never fed and the clock is unsynced: the level is starving, the screen shows "—".
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] idle cat=Luna level=starving"));
    r.pushAndTick(InputEvent::RotateCW, 20);
    TEST_ASSERT_TRUE(r.app->roster().isAllSelected());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] idle cat=all level=starving"));
    r.pushAndTick(InputEvent::RotateCW, 30);
    TEST_ASSERT_EQUAL_STRING("Mochi", r.app->roster().selected()->name.c_str());
    // The boot round runs once the network is up and prints the sync line the scenarios wait for.
    r.net.online = true;
    r.pushHappyRound();
    r.tick(40);
    TEST_ASSERT_EQUAL_STRING("boot", r.app->sync().last().reason.c_str());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] sync ok accepted=0 state=changed"));
    TEST_ASSERT_TRUE(r.app->clockSynced());
}

void test_app_knob_feed_flow_single_cat() {
    Rig r;
    r.net.online = true;
    r.pushHappyRound();
    r.app->begin();
    r.tick(0);   // boot round
    r.pushAndTick(InputEvent::Press, 100);
    TEST_ASSERT_EQUAL(ScreenId::Amount, r.screen());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] screen=amount"));
    TEST_ASSERT_EQUAL_INT32(40000, r.app->flow().amountMg());
    TEST_ASSERT_EQUAL_STRING("40 g", r.app->flow().amountText().c_str());
    r.pushAndTick(InputEvent::RotateCW, 200);
    TEST_ASSERT_EQUAL_INT32(45000, r.app->flow().amountMg());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] amount cat=Mochi mg=45000"));
    r.pushAndTick(InputEvent::RotateCCW, 250);
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] amount cat=Mochi mg=40000"));
    r.pushAndTick(InputEvent::RotateCW, 300);
    // Press logs it: one draft of 45 g, queued and persisted, Fed on screen, and the feeding round
    // runs on the same tick because the network is up.
    r.net.feedingResults.push_back(test::StubNetwork::ok("{\"accepted\":[\"00000000-0000-4000-8000-000000000001\"],\"clamped\":[],\"now\":1700003600000}"));
    r.pushHappyRound();
    r.pushAndTick(InputEvent::Press, 400);
    TEST_ASSERT_EQUAL(ScreenId::Fed, r.screen());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] feeding queued id=00000000-0000-4000-8000-000000000001"));
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] screen=fed"));
    TEST_ASSERT_TRUE(r.serialIndex("feeding queued") < r.serialIndex("screen=fed"));
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] fed cat=Mochi mg=45000"));
    TEST_ASSERT_EQUAL_STRING("Mochi", r.app->fedSummary().label.c_str());
    TEST_ASSERT_EQUAL_INT32(45000, r.app->fedSummary().amountMg);
    TEST_ASSERT_EQUAL_UINT32(1, r.net.postedFeedings.size());
    TEST_ASSERT_EQUAL_STRING("feeding", r.app->sync().last().reason.c_str());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] sync ok accepted=1 state=changed"));
    TEST_ASSERT_TRUE(r.app->feedings().queue().empty());
    TEST_ASSERT_EQUAL_UINT32(1, r.app->feedings().recent().size());
    TEST_ASSERT_EQUAL_INT32(45000, r.app->feedings().recent()[0].amountMg);
    TEST_ASSERT_EQUAL_UINT32(1, r.app->historyEntries().size());
    TEST_ASSERT_EQUAL_STRING("Mochi", r.app->historyEntries()[0].catName.c_str());
    // Fed stays for 2 s, then Idle re-renders on its own; the router stack is back to one entry.
    r.tick(2399);
    TEST_ASSERT_EQUAL(ScreenId::Fed, r.screen());
    const size_t idleLines = r.serialCount("[feedme2] idle cat=");
    r.tick(2400);
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());
    TEST_ASSERT_TRUE(r.app->router().atRoot());
    TEST_ASSERT_EQUAL(domain::Phase::Idle, r.app->flow().phase());
    TEST_ASSERT_EQUAL_UINT32(idleLines + 1, r.serialCount("[feedme2] idle cat="));
    // Press on Fed skips the wait.
    r.pushAndTick(InputEvent::Press, 3000);
    r.pushAndTick(InputEvent::Press, 3100);
    TEST_ASSERT_EQUAL(ScreenId::Fed, r.screen());
    r.pushAndTick(InputEvent::Press, 3200);
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());
    // Long press on Amount cancels: nothing queued, back on Idle.
    const size_t queued = r.serialCount("feeding queued");
    r.pushAndTick(InputEvent::Press, 4000);
    r.pushAndTick(InputEvent::LongPress, 4100);
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());
    TEST_ASSERT_EQUAL(domain::Phase::Idle, r.app->flow().phase());
    TEST_ASSERT_EQUAL_UINT32(queued, r.serialCount("feeding queued"));
}

void test_app_all_cats_feed_creates_one_per_cat() {
    Rig r;
    r.app->begin();
    r.pushAndTick(InputEvent::RotateCW, 10);
    r.pushAndTick(InputEvent::RotateCW, 20);
    TEST_ASSERT_TRUE(r.app->roster().isAllSelected());
    r.pushAndTick(InputEvent::Press, 30);
    TEST_ASSERT_EQUAL(ScreenId::Amount, r.screen());
    TEST_ASSERT_TRUE(r.app->flow().isAll());
    TEST_ASSERT_EQUAL_STRING("1 x", r.app->flow().amountText().c_str());
    r.pushAndTick(InputEvent::RotateCW, 40);
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] amount cat=all mg=0 text=1 1/2 x"));
    r.pushAndTick(InputEvent::RotateCCW, 50);
    r.pushAndTick(InputEvent::Press, 60);
    TEST_ASSERT_EQUAL(ScreenId::Fed, r.screen());
    // Mochi's own default and Luna's house fallback (Review Focus 5), one line each.
    TEST_ASSERT_EQUAL_UINT32(2, r.app->feedings().queue().size());
    TEST_ASSERT_EQUAL_INT32(40000, r.app->feedings().queue().items()[0].amountMg);
    TEST_ASSERT_EQUAL_INT32(40000, r.app->feedings().queue().items()[1].amountMg);
    TEST_ASSERT_EQUAL_UINT32(2, r.serialCount("[feedme2] feeding queued id="));
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] fed cat=all mg=80000 n=2"));
    TEST_ASSERT_EQUAL_STRING("2 cats", r.app->fedSummary().label.c_str());
    TEST_ASSERT_EQUAL_INT(2, r.app->fedSummary().cats);
    // Offline: the round waits and the queue keeps the device out of light sleep.
    TEST_ASSERT_TRUE(r.app->sync().roundRequested());
    TEST_ASSERT_TRUE(r.app->power().busy());
    TEST_ASSERT_EQUAL_UINT32(2, r.files.files["/feedings.jsonl"].size());
}

void test_app_double_tap_history_and_long_press_system_menu() {
    Rig r;
    r.app->begin();
    r.pushAndTick(InputEvent::DoubleTap, 10);
    TEST_ASSERT_EQUAL(ScreenId::History, r.screen());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] screen=history"));
    // Nothing queued yet: the rows come from the state's lastFedAt (Mochi only; Luna was never fed).
    TEST_ASSERT_EQUAL_UINT32(1, r.app->historyEntries().size());
    TEST_ASSERT_EQUAL_STRING("Mochi", r.app->historyEntries()[0].catName.c_str());
    TEST_ASSERT_FALSE(r.app->historyEntries()[0].amountKnown);
    TEST_ASSERT_EQUAL_INT64(1700000000000LL, r.app->historyEntries()[0].fedAtMs);
    // Scrolling is bounded by the rows there are.
    TEST_ASSERT_EQUAL_INT(0, r.app->historyOffset());
    r.pushAndTick(InputEvent::RotateCCW, 20);
    TEST_ASSERT_EQUAL_INT(0, r.app->historyOffset());
    r.pushAndTick(InputEvent::RotateCW, 30);
    TEST_ASSERT_EQUAL_INT(0, r.app->historyOffset());
    r.pushAndTick(InputEvent::Press, 40);
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());
    // System menu: rotate wraps over four entries, Press opens, DoubleTap and LongPress go back.
    r.pushAndTick(InputEvent::LongPress, 50);
    TEST_ASSERT_EQUAL(ScreenId::System, r.screen());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] screen=system"));
    TEST_ASSERT_EQUAL_INT(0, r.app->menuIndex());
    TEST_ASSERT_EQUAL_STRING("Wi-Fi", r.app->menuLabel(0));
    TEST_ASSERT_EQUAL_STRING("Unpair", r.app->menuLabel(1));
    TEST_ASSERT_EQUAL_STRING("About", r.app->menuLabel(2));
    TEST_ASSERT_EQUAL_STRING("Sleep now", r.app->menuLabel(3));
    r.pushAndTick(InputEvent::RotateCCW, 60);
    TEST_ASSERT_EQUAL_INT(3, r.app->menuIndex());
    r.pushAndTick(InputEvent::RotateCW, 70);
    r.pushAndTick(InputEvent::RotateCW, 80);
    TEST_ASSERT_EQUAL_INT(1, r.app->menuIndex());
    r.pushAndTick(InputEvent::Press, 90);
    TEST_ASSERT_EQUAL(ScreenId::UnpairConfirm, r.screen());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] screen=unpair"));
    r.pushAndTick(InputEvent::DoubleTap, 100);
    TEST_ASSERT_EQUAL(ScreenId::System, r.screen());
    r.pushAndTick(InputEvent::RotateCW, 110);
    r.pushAndTick(InputEvent::Press, 120);
    TEST_ASSERT_EQUAL(ScreenId::About, r.screen());
    r.pushAndTick(InputEvent::LongPress, 130);
    TEST_ASSERT_EQUAL(ScreenId::System, r.screen());
    r.pushAndTick(InputEvent::RotateCCW, 140);
    r.pushAndTick(InputEvent::RotateCCW, 150);
    r.pushAndTick(InputEvent::Press, 160);
    TEST_ASSERT_EQUAL(ScreenId::WifiList, r.screen());
    r.pushAndTick(InputEvent::LongPress, 170);
    TEST_ASSERT_EQUAL(ScreenId::System, r.screen());
    r.pushAndTick(InputEvent::LongPress, 180);
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());
    TEST_ASSERT_TRUE(r.app->router().atRoot());
    // Still paired: nothing above touched the token or started a pairing.
    TEST_ASSERT_TRUE(r.app->pair().isPaired());
    TEST_ASSERT_TRUE(r.net.pairStarts.empty());
}

void test_app_unauthorized_during_sync_returns_to_pair() {
    Rig r;
    r.net.online = true;
    r.net.logResults.push_back(test::StubNetwork::status(202));
    r.net.stateResults.push_back(test::StubNetwork::status(401));
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"424242\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.app->begin();
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());
    const uint32_t gen = r.app->uiGeneration();
    r.tick(10);   // boot round → 401
    TEST_ASSERT_TRUE(r.app->sync().last().unauthorized);
    TEST_ASSERT_FALSE(r.app->pair().isPaired());
    TEST_ASSERT_EQUAL(ScreenId::Pair, r.screen());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] screen=pair from=idle"));
    TEST_ASSERT_EQUAL_UINT32(1, r.net.pairStarts.size());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] pair start code=424242"));
    // The cached house is gone mid-session: Idle's inputs must survive an empty roster.
    TEST_ASSERT_FALSE(r.app->hasState());
    TEST_ASSERT_EQUAL_UINT32(0, r.app->roster().count());
    TEST_ASSERT_TRUE(r.app->uiGeneration() > gen);
    // Re-pair (maybe to another house): Idle again, and a "paired" round fetches the new state.
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"confirmed\",\"deviceToken\":\"tok2\",\"houseId\":\"h2\",\"deviceName\":\"Kitchen\"}"));
    r.pushHappyRound();
    r.tick(3200);
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());
    TEST_ASSERT_EQUAL_STRING("paired", r.app->sync().last().reason.c_str());
    TEST_ASSERT_EQUAL_STRING("", r.net.ifNoneMatch.back().c_str());
    TEST_ASSERT_TRUE(r.app->hasState());
    TEST_ASSERT_EQUAL_UINT32(3, r.app->roster().count());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] idle cat=Mochi level=content"));
}

void test_app_idle_press_with_no_cats_stays_on_idle() {
    // Paired but the house has no cats yet (or the state was erased by a 401 and nothing came back).
    Rig r(true, false);
    r.app->begin();
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] idle cat=none level=none"));
    r.pushAndTick(InputEvent::RotateCW, 10);
    r.pushAndTick(InputEvent::Press, 20);
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());
    TEST_ASSERT_EQUAL(domain::Phase::Idle, r.app->flow().phase());
    // The menu and history still open.
    r.pushAndTick(InputEvent::LongPress, 30);
    TEST_ASSERT_EQUAL(ScreenId::System, r.screen());
    r.pushAndTick(InputEvent::LongPress, 40);
    r.pushAndTick(InputEvent::DoubleTap, 50);
    TEST_ASSERT_EQUAL(ScreenId::History, r.screen());
    TEST_ASSERT_TRUE(r.app->historyEntries().empty());
}

void test_app_first_event_after_dim_is_swallowed_and_requests_wake_round() {
    Rig r;
    r.net.online = true;
    r.pushHappyRound();
    r.app->begin();
    r.tick(0);   // boot round
    r.tick(16'000);
    TEST_ASSERT_EQUAL(PowerTier::Dim, r.app->power().tier());
    TEST_ASSERT_EQUAL_UINT32(0, r.app->roster().index());
    // Ticks without input must not consume the wake flag: it is set when the knob goes down and the
    // Press only arrives after the long-press window.
    r.input.held = true;
    r.tick(16'100);
    TEST_ASSERT_EQUAL(PowerTier::Awake, r.app->power().tier());
    r.tick(16'200);
    r.tick(16'300);
    r.input.held = false;
    r.pushHappyRound();
    r.pushAndTick(InputEvent::Press, 16'500);
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());   // swallowed: no Amount screen
    TEST_ASSERT_EQUAL_STRING("wake", r.app->sync().last().reason.c_str());
    // The second event is real.
    r.pushAndTick(InputEvent::RotateCW, 16'600);
    TEST_ASSERT_EQUAL_UINT32(1, r.app->roster().index());
    // The same from light sleep: the waking turn changes nothing, and the wake round carries its reason.
    r.tick(47'000);
    TEST_ASSERT_EQUAL(PowerTier::LightSleep, r.app->power().tier());
    const size_t rounds = r.net.postedHeartbeats.size();
    r.pushHappyRound();
    r.pushAndTick(InputEvent::RotateCW, 47'100);
    TEST_ASSERT_EQUAL(PowerTier::Awake, r.app->power().tier());
    TEST_ASSERT_EQUAL_UINT32(1, r.app->roster().index());
    TEST_ASSERT_EQUAL_UINT32(rounds + 1, r.net.postedHeartbeats.size());
    TEST_ASSERT_EQUAL_STRING("wake", r.app->sync().last().reason.c_str());
}

void test_app_timer_wake_requests_timer_round_and_queue_holds_device_awake() {
    Rig r;
    r.net.online = true;
    r.pushHappyRound();
    r.app->begin();
    r.tick(0);   // boot round; the sample's sync interval (6 h) reaches the power manager
    r.tick(31'000);
    TEST_ASSERT_EQUAL(PowerTier::LightSleep, r.app->power().tier());
    const int naps = r.power.lightSleeps;
    r.pushHappyRound();
    r.tick(31'000 + 21'600'000);
    TEST_ASSERT_EQUAL_STRING("timer", r.app->sync().last().reason.c_str());
    // A timer wake leaves the screen off: the round ran and the device naps again on the next tick.
    TEST_ASSERT_EQUAL(PowerTier::LightSleep, r.app->power().tier());
    TEST_ASSERT_TRUE(r.power.displayAsleep);
    r.tick(31'000 + 21'600'000 + 10);
    TEST_ASSERT_TRUE(r.power.lightSleeps > naps);
    // A queued feeding (offline) keeps the device from napping until it is sent.
    Rig q;
    q.app->begin();
    q.pushAndTick(InputEvent::Press, 10);
    q.pushAndTick(InputEvent::Press, 20);
    q.tick(60'000);
    TEST_ASSERT_EQUAL(PowerTier::Dim, q.app->power().tier());
    TEST_ASSERT_EQUAL_INT(0, q.power.lightSleeps);
}

void test_app_long_press_arc_follows_the_held_knob() {
    Rig r;
    r.app->begin();
    r.tick(0);
    TEST_ASSERT_FALSE(r.app->arc().charging());
    r.input.held = true;
    r.tick(100);
    TEST_ASSERT_TRUE(r.app->arc().charging());
    TEST_ASSERT_EQUAL_INT(0, r.app->arc().percent());
    r.tick(400);
    TEST_ASSERT_EQUAL_INT(50, r.app->arc().percent());
    r.tick(700);
    TEST_ASSERT_EQUAL_INT(100, r.app->arc().percent());
    r.input.held = false;
    r.tick(800);
    TEST_ASSERT_FALSE(r.app->arc().charging());
    TEST_ASSERT_EQUAL_INT(0, r.app->arc().percent());
    // Holding never dims.
    r.input.held = true;
    r.tick(40'000);
    TEST_ASSERT_EQUAL(PowerTier::Awake, r.app->power().tier());
}

void test_app_unpair_long_press_clears_token() {
    Rig r;
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"424242\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.app->begin();
    r.pushAndTick(InputEvent::LongPress, 10);
    r.pushAndTick(InputEvent::RotateCW, 20);
    r.pushAndTick(InputEvent::Press, 30);
    TEST_ASSERT_EQUAL(ScreenId::UnpairConfirm, r.screen());
    // Press and rotate do nothing here: only the hold confirms.
    r.pushAndTick(InputEvent::Press, 40);
    r.pushAndTick(InputEvent::RotateCW, 50);
    TEST_ASSERT_EQUAL(ScreenId::UnpairConfirm, r.screen());
    TEST_ASSERT_TRUE(r.app->pair().isPaired());
    r.pushAndTick(InputEvent::LongPress, 60);
    TEST_ASSERT_FALSE(r.app->pair().isPaired());
    TEST_ASSERT_EQUAL_UINT32(0, r.store.kv.count("token"));
    TEST_ASSERT_EQUAL_STRING("", r.net.token.c_str());
    TEST_ASSERT_EQUAL(ScreenId::Pair, r.screen());
    TEST_ASSERT_TRUE(r.app->router().atRoot());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] screen=pair from=unpair"));
    TEST_ASSERT_EQUAL_UINT32(1, r.net.pairStarts.size());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] pair start code=424242"));
    TEST_ASSERT_EQUAL_STRING("Pair", r.app->menuLabel(1));
}

void test_app_sleep_now_naps_on_the_next_tick() {
    Rig r;
    r.net.online = true;
    r.pushHappyRound();
    r.app->begin();
    r.tick(0);   // boot round done: nothing holds the device awake
    r.pushAndTick(InputEvent::LongPress, 10);
    r.pushAndTick(InputEvent::RotateCCW, 20);
    TEST_ASSERT_EQUAL_INT(3, r.app->menuIndex());
    r.pushAndTick(InputEvent::Press, 30);
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());
    r.tick(31);
    TEST_ASSERT_EQUAL(PowerTier::LightSleep, r.app->power().tier());
    TEST_ASSERT_EQUAL_INT(1, r.power.lightSleeps);
    // The knob wakes it to Idle, as after any nap.
    r.pushAndTick(InputEvent::Press, 1000);
    TEST_ASSERT_EQUAL(PowerTier::Awake, r.app->power().tier());
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.screen());
}

void test_app_hunger_uses_the_snapshot_clock_until_the_server_answers() {
    Rig r;
    r.app->begin();
    const auto& mochi = r.app->roster().cats()[0];
    // The cached snapshot was taken an hour after the feeding; the device has been up 30 s.
    r.tick(30'000);
    auto h = r.app->hungerOf(mochi);
    TEST_ASSERT_EQUAL(domain::HungerLevel::Content, h.level);
    TEST_ASSERT_DOUBLE_WITHIN(0.5, 3630.0, h.ageSec);
    TEST_ASSERT_INT64_WITHIN(1, 1700003630000LL, r.app->wallNowMs());
    // Server time wins once it arrives.
    r.net.online = true;
    r.net.logResults.push_back(test::StubNetwork::status(202));
    r.net.stateResults.push_back(test::StubNetwork::status(304));
    r.net.heartbeatResults.push_back(test::StubNetwork::ok("{\"now\":1700020000000}"));
    r.tick(40'000);
    TEST_ASSERT_TRUE(r.app->clockSynced());
    TEST_ASSERT_EQUAL_INT64(1700020000000LL, r.app->wallNowMs());
    TEST_ASSERT_EQUAL(domain::HungerLevel::VeryHungry, r.app->hungerOf(mochi).level);
    TEST_ASSERT_EQUAL(domain::HungerLevel::VeryHungry, r.app->selectedLevel());
    // "All" reports the hungriest cat (Luna was never fed). The screen dimmed 15 s after boot, so
    // the first turn only wakes it.
    TEST_ASSERT_EQUAL(PowerTier::Dim, r.app->power().tier());
    r.pushAndTick(InputEvent::RotateCW, 40'100);
    TEST_ASSERT_EQUAL_UINT32(0, r.app->roster().index());
    r.pushAndTick(InputEvent::RotateCW, 40'200);
    r.pushAndTick(InputEvent::RotateCW, 40'300);
    TEST_ASSERT_TRUE(r.app->roster().isAllSelected());
    TEST_ASSERT_EQUAL(domain::HungerLevel::Starving, r.app->selectedLevel());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] idle cat=all level=starving"));
}
