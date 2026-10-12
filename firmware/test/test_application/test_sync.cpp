#include <unity.h>
#include "application/FeedingService.h"
#include "application/LogService.h"
#include "application/PairCoordinator.h"
#include "application/SyncService.h"
#include "fixtures.h"
#include "stubs.h"
using namespace feedme2;

namespace {
struct Rig {
    test::StubNetwork net; test::StubStorage store; test::StubClock clk; test::StubLogSink serial; test::StubFileQueue files; test::StubRandom rnd;
    domain::ClockModel model;
    application::LogService log{serial, files, clk, model};
    application::FeedingService feedings{files, rnd, model, log};
    application::PairCoordinator pair{net, store, clk, rnd, log, "0123456789abcdef0123456789abcdef", "device-sim", "0.2.0"};
    application::SyncService sync{net, store, clk, model, feedings, log, pair};
    // A round only makes sense for a paired device; every test starts paired unless it says otherwise.
    Rig() { store.kv["token"] = "tok"; }

    std::string queueOne(const char* catId) {
        domain::DeviceState s; domain::CatState c; c.id = catId; c.hasDefault = true; c.defaultAmountMg = 40000; s.cats = {c};
        domain::FeedFlow flow; flow.begin(s, &s.cats[0], 0);
        return feedings.commit(flow, 0)[0].id;
    }
    bool serialHas(const char* needle) const {
        for (const auto& l : serial.lines) if (l.find(needle) != std::string::npos) return true;
        return false;
    }
    // Pushes a full happy-path round: nothing to accept, state 200, heartbeat ok.
    void pushHappyRound(const std::string& stateJson) {
        net.logResults.push_back(test::StubNetwork::status(202));
        net.stateResults.push_back(test::StubNetwork::ok(stateJson, "W/\"abc\""));
        net.heartbeatResults.push_back(test::StubNetwork::ok("{\"now\":1700000000000}"));
    }
};
std::string sample() { return readFixture("device-state.sample.json"); }
std::string replaceAll(std::string s, const std::string& from, const std::string& to) {
    for (size_t p = s.find(from); p != std::string::npos; p = s.find(from, p + to.size())) s.replace(p, from.size(), to);
    return s;
}
}  // namespace

void test_sync_round_order_and_success() {
    Rig r;
    const std::string id = r.queueOne("cat-a");
    r.log.info("hello");
    r.net.feedingResults.push_back(test::StubNetwork::ok("{\"accepted\":[\"" + id + "\"],\"clamped\":[],\"now\":1700000000000}"));
    r.pushHappyRound(sample());
    r.sync.requestRound("feeding");
    r.sync.tick(10);
    const auto& last = r.sync.last();
    TEST_ASSERT_TRUE(last.ran);
    TEST_ASSERT_EQUAL_INT(1, last.feedingsSent);
    TEST_ASSERT_EQUAL_INT(1, last.feedingsAccepted);
    TEST_ASSERT_TRUE(last.logsSent > 0);
    TEST_ASSERT_TRUE(last.stateChanged);
    TEST_ASSERT_TRUE(last.heartbeatOk);
    TEST_ASSERT_FALSE(last.unauthorized);
    TEST_ASSERT_EQUAL_STRING("", last.stoppedBy.c_str());
    TEST_ASSERT_TRUE(r.sync.lastRoundOk());
    TEST_ASSERT_EQUAL_UINT32(10, r.sync.lastOkAtMs());
    TEST_ASSERT_TRUE(r.feedings.queue().empty());
    // Order: feedings, then logs (the "hello" line travels in the first logs batch), then state, then heartbeat.
    TEST_ASSERT_EQUAL_UINT32(1, r.net.postedFeedings.size());
    TEST_ASSERT_TRUE(r.net.postedLogs[0].find("hello") != std::string::npos);
    TEST_ASSERT_EQUAL_UINT32(1, r.net.ifNoneMatch.size());
    TEST_ASSERT_EQUAL_STRING("", r.net.ifNoneMatch[0].c_str());
    TEST_ASSERT_EQUAL_UINT32(1, r.net.postedHeartbeats.size());
    TEST_ASSERT_EQUAL_STRING("W/\"abc\"", r.store.kv["etag"].c_str());
    TEST_ASSERT_EQUAL_STRING(sample().c_str(), r.store.kv["state"].c_str());
    TEST_ASSERT_TRUE(r.model.isSynced());
    TEST_ASSERT_TRUE(r.sync.hasState());
    TEST_ASSERT_EQUAL_UINT32(2, r.sync.state().cats.size());
    TEST_ASSERT_EQUAL_UINT32(1, r.sync.generation());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] sync start reason=feeding"));
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] sync ok accepted=1 state=changed"));
    // Second round: the cached ETag goes out and a 304 keeps the state.
    r.net.logResults.push_back(test::StubNetwork::status(202));
    r.net.stateResults.push_back(test::StubNetwork::status(304));
    r.net.heartbeatResults.push_back(test::StubNetwork::ok("{\"now\":1700000001000}"));
    r.sync.requestRound("wake");
    r.sync.tick(20);
    TEST_ASSERT_EQUAL_STRING("W/\"abc\"", r.net.ifNoneMatch[1].c_str());
    TEST_ASSERT_FALSE(r.sync.last().stateChanged);
    TEST_ASSERT_EQUAL_UINT32(1, r.sync.generation());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] sync ok accepted=0 state=same"));
}

void test_sync_transient_failure_keeps_feedings_and_stops() {
    Rig r;
    r.queueOne("cat-a");
    r.net.feedingResults.push_back(test::StubNetwork::status(503));
    r.sync.requestRound("feeding");
    r.sync.tick(10);
    TEST_ASSERT_TRUE(r.sync.last().ran);
    TEST_ASSERT_EQUAL_STRING("feedings", r.sync.last().stoppedBy.c_str());
    TEST_ASSERT_FALSE(r.sync.lastRoundOk());
    TEST_ASSERT_EQUAL_UINT32(1, r.feedings.queue().size());
    TEST_ASSERT_TRUE(r.net.ifNoneMatch.empty());
    TEST_ASSERT_TRUE(r.net.postedHeartbeats.empty());
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] sync stopped at=feedings status=503"));
}

void test_sync_permanent_failure_drops_batch_and_continues() {
    Rig r;
    r.queueOne("cat-a");
    r.net.feedingResults.push_back(test::StubNetwork::status(400, "{\"error\":\"invalid_request\"}"));
    r.pushHappyRound(sample());
    r.sync.requestRound("feeding");
    r.sync.tick(10);
    TEST_ASSERT_TRUE(r.feedings.queue().empty());
    TEST_ASSERT_EQUAL_INT(0, r.sync.last().feedingsAccepted);
    TEST_ASSERT_TRUE(r.serialHas("error feedings rejected"));
    TEST_ASSERT_EQUAL_UINT32(1, r.net.ifNoneMatch.size());
    TEST_ASSERT_TRUE(r.sync.lastRoundOk());
}

void test_sync_cat_not_found_drops_only_that_cat() {
    Rig r;
    r.queueOne("cat-gone");
    const std::string keep = r.queueOne("cat-b");
    r.net.feedingResults.push_back(test::StubNetwork::status(404, "{\"error\":\"cat_not_found\",\"catIds\":[\"cat-gone\"]}"));
    r.net.feedingResults.push_back(test::StubNetwork::ok("{\"accepted\":[\"" + keep + "\"],\"clamped\":[],\"now\":1700000000000}"));
    r.pushHappyRound(sample());
    r.sync.requestRound("feeding");
    r.sync.tick(10);
    TEST_ASSERT_TRUE(r.feedings.queue().empty());
    TEST_ASSERT_EQUAL_UINT32(2, r.net.postedFeedings.size());
    TEST_ASSERT_TRUE(r.net.postedFeedings[1].find("cat-gone") == std::string::npos);
    TEST_ASSERT_TRUE(r.net.postedFeedings[1].find(keep) != std::string::npos);
    TEST_ASSERT_EQUAL_INT(1, r.sync.last().feedingsAccepted);
    TEST_ASSERT_TRUE(r.serialHas("warn feedings dropped: cat not found"));
}

void test_sync_id_conflict_settles_those_ids() {
    Rig r;
    const std::string id = r.queueOne("cat-a");
    r.net.feedingResults.push_back(test::StubNetwork::status(409, "{\"error\":\"id_conflict\",\"ids\":[\"" + id + "\"]}"));
    r.pushHappyRound(sample());
    r.sync.requestRound("feeding");
    r.sync.tick(10);
    TEST_ASSERT_TRUE(r.feedings.queue().empty());
    TEST_ASSERT_EQUAL_UINT32(1, r.net.postedFeedings.size());
    TEST_ASSERT_TRUE(r.sync.lastRoundOk());
}

void test_sync_ok_with_fewer_accepted_settles_the_sent_ids() {
    // A retry after a lost 201: the server already holds the id (ON CONFLICT DO NOTHING) and
    // reports accepted=[]; the device must not resend that feeding forever.
    Rig r;
    r.queueOne("cat-a");
    r.net.feedingResults.push_back(test::StubNetwork::ok("{\"accepted\":[],\"clamped\":[],\"now\":1700000000000}"));
    r.pushHappyRound(sample());
    r.sync.requestRound("feeding");
    r.sync.tick(10);
    TEST_ASSERT_TRUE(r.feedings.queue().empty());
    TEST_ASSERT_EQUAL_UINT32(1, r.net.postedFeedings.size());
    TEST_ASSERT_TRUE(r.serialHas("warn feedings already on server"));
}

void test_sync_unauthorized_clears_token_and_routes_to_pair() {
    Rig r;
    r.net.logResults.push_back(test::StubNetwork::status(202));
    r.net.stateResults.push_back(test::StubNetwork::status(401));
    r.sync.requestRound("boot");
    r.sync.tick(10);
    TEST_ASSERT_TRUE(r.sync.last().unauthorized);
    TEST_ASSERT_EQUAL_STRING("state", r.sync.last().stoppedBy.c_str());
    TEST_ASSERT_FALSE(r.pair.isPaired());
    TEST_ASSERT_EQUAL_STRING("", r.net.token.c_str());
    TEST_ASSERT_TRUE(r.net.postedHeartbeats.empty());
    // Unpaired now: a requested round must not run (it would 401 again forever).
    r.sync.requestRound("timer");
    r.sync.tick(20);
    TEST_ASSERT_EQUAL_UINT32(1, r.net.ifNoneMatch.size());
}

void test_sync_cached_state_loads_before_network() {
    Rig r;
    r.store.kv["state"] = sample();
    r.store.kv["etag"] = "W/\"x\"";
    TEST_ASSERT_FALSE(r.sync.hasState());
    TEST_ASSERT_EQUAL_UINT32(0, r.sync.generation());
    r.sync.loadCachedState();
    TEST_ASSERT_TRUE(r.sync.hasState());
    TEST_ASSERT_EQUAL_UINT32(2, r.sync.state().cats.size());
    TEST_ASSERT_EQUAL_UINT32(1, r.sync.generation());
    TEST_ASSERT_TRUE(r.net.ifNoneMatch.empty());
    // A cached state is a snapshot, not a clock: nothing says how old it is.
    TEST_ASSERT_FALSE(r.model.isSynced());
}

void test_sync_corrupt_cached_state_is_ignored_and_etag_dropped() {
    Rig r;
    r.store.kv["state"] = "{not json";
    r.store.kv["etag"] = "W/\"x\"";
    r.sync.loadCachedState();
    TEST_ASSERT_FALSE(r.sync.hasState());
    // With no usable state a 304 would leave the device blank, so the next GET must be unconditional.
    r.net.logResults.push_back(test::StubNetwork::status(202));
    r.net.stateResults.push_back(test::StubNetwork::ok(sample(), "W/\"abc\""));
    r.net.heartbeatResults.push_back(test::StubNetwork::ok("{\"now\":1}"));
    r.sync.requestRound("boot");
    r.sync.tick(10);
    TEST_ASSERT_EQUAL_STRING("", r.net.ifNoneMatch[0].c_str());
    TEST_ASSERT_TRUE(r.sync.hasState());
}

void test_sync_timer_round_every_sync_interval() {
    Rig r;
    r.store.kv["state"] = replaceAll(sample(), "\"syncIntervalSec\": 21600", "\"syncIntervalSec\": 60");
    r.sync.loadCachedState();
    TEST_ASSERT_EQUAL_INT32(60, r.sync.state().settings.syncIntervalSec);
    r.sync.tick(1000);
    TEST_ASSERT_FALSE(r.sync.last().ran);
    r.sync.tick(61000);
    TEST_ASSERT_TRUE(r.sync.last().ran);
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] sync start reason=timer"));
    // The next timer round is one interval after the last one, not every tick.
    const size_t starts = r.serial.lines.size();
    r.sync.tick(62000);
    TEST_ASSERT_EQUAL_UINT32(starts, r.serial.lines.size());
}

void test_sync_offline_skips_round_until_online() {
    Rig r;
    r.net.online = false;
    r.sync.requestRound("wake");
    r.sync.tick(10);
    TEST_ASSERT_FALSE(r.sync.last().ran);
    TEST_ASSERT_TRUE(r.net.ifNoneMatch.empty());
    r.net.online = true;
    r.net.logResults.push_back(test::StubNetwork::status(202));
    r.sync.tick(20);
    TEST_ASSERT_TRUE(r.sync.last().ran);
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] sync start reason=wake"));
    // The request was consumed: no second round without a new request.
    r.sync.tick(30);
    TEST_ASSERT_EQUAL_UINT32(1, r.net.ifNoneMatch.size());
}

void test_sync_heartbeat_syncs_the_clock_when_state_is_304() {
    Rig r;
    r.store.kv["state"] = sample();
    r.store.kv["etag"] = "W/\"x\"";
    r.sync.loadCachedState();
    r.net.logResults.push_back(test::StubNetwork::status(202));
    r.net.stateResults.push_back(test::StubNetwork::status(304));
    r.net.heartbeatResults.push_back(test::StubNetwork::ok("{\"now\":1700000000000}"));
    r.clk.ms = 5000;
    r.sync.requestRound("boot");
    r.sync.tick(5000);
    TEST_ASSERT_EQUAL_STRING("W/\"x\"", r.net.ifNoneMatch[0].c_str());
    TEST_ASSERT_FALSE(r.sync.last().stateChanged);
    TEST_ASSERT_TRUE(r.sync.last().heartbeatOk);
    TEST_ASSERT_TRUE(r.model.isSynced());
    TEST_ASSERT_EQUAL_INT64(1700000000000LL, r.model.nowMs());
    TEST_ASSERT_TRUE(r.net.postedHeartbeats[0].find("\"uptimeSec\":5") != std::string::npos);
}

void test_sync_logs_transient_requeues_and_stops() {
    Rig r;
    r.log.info("keep me");
    r.net.logResults.push_back(test::StubNetwork::status(503));
    r.sync.requestRound("wake");
    r.sync.tick(10);
    TEST_ASSERT_EQUAL_STRING("logs", r.sync.last().stoppedBy.c_str());
    TEST_ASSERT_EQUAL_INT(0, r.sync.last().logsSent);
    TEST_ASSERT_TRUE(r.net.ifNoneMatch.empty());
    // Requeued in order: the batch is back in front, so the next upload still starts with "keep me".
    TEST_ASSERT_TRUE(r.log.pending() >= 2);
    TEST_ASSERT_TRUE(r.log.takeBatch(1)[0].find("keep me") != std::string::npos);
}

void test_sync_logs_permanent_drops_batch_and_continues() {
    Rig r;
    r.log.info("poison");
    r.net.logResults.push_back(test::StubNetwork::status(400, "{\"error\":\"invalid_request\"}"));
    r.net.stateResults.push_back(test::StubNetwork::ok(sample(), "W/\"abc\""));
    r.net.heartbeatResults.push_back(test::StubNetwork::ok("{\"now\":1}"));
    r.sync.requestRound("wake");
    r.sync.tick(10);
    TEST_ASSERT_TRUE(r.sync.lastRoundOk());
    TEST_ASSERT_EQUAL_UINT32(1, r.net.ifNoneMatch.size());
    TEST_ASSERT_TRUE(r.serialHas("warn logs rejected"));
    bool poisonStillPending = false;
    for (const auto& l : r.log.takeBatch(50)) if (l.find("poison") != std::string::npos) poisonStillPending = true;
    TEST_ASSERT_FALSE(poisonStillPending);
}

void test_sync_heartbeat_failure_is_not_fatal() {
    Rig r;
    r.net.logResults.push_back(test::StubNetwork::status(202));
    r.net.stateResults.push_back(test::StubNetwork::ok(sample(), "W/\"abc\""));
    r.net.heartbeatResults.push_back(test::StubNetwork::status(500));
    r.sync.requestRound("boot");
    r.sync.tick(10);
    TEST_ASSERT_FALSE(r.sync.last().heartbeatOk);
    TEST_ASSERT_TRUE(r.sync.lastRoundOk());
    TEST_ASSERT_TRUE(r.serialHas("warn heartbeat failed"));
    TEST_ASSERT_TRUE(r.serialHas("[feedme2] sync ok accepted=0 state=changed"));
    TEST_ASSERT_TRUE(r.model.isSynced());   // the state's `now` already corrected the clock
}

void test_sync_state_decode_failure_keeps_old_state() {
    Rig r;
    r.store.kv["state"] = sample();
    r.store.kv["etag"] = "W/\"x\"";
    r.sync.loadCachedState();
    r.net.logResults.push_back(test::StubNetwork::status(202));
    r.net.stateResults.push_back(test::StubNetwork::ok("{\"house\":{}}", "W/\"bad\""));
    r.net.heartbeatResults.push_back(test::StubNetwork::ok("{\"now\":1}"));
    r.sync.requestRound("boot");
    r.sync.tick(10);
    TEST_ASSERT_EQUAL_UINT32(2, r.sync.state().cats.size());
    TEST_ASSERT_EQUAL_UINT32(1, r.sync.generation());
    TEST_ASSERT_FALSE(r.sync.last().stateChanged);
    TEST_ASSERT_EQUAL_STRING("W/\"x\"", r.store.kv["etag"].c_str());
    TEST_ASSERT_EQUAL_STRING(sample().c_str(), r.store.kv["state"].c_str());
    TEST_ASSERT_TRUE(r.serialHas("error state decode failed"));
    TEST_ASSERT_TRUE(r.sync.last().heartbeatOk);
}
