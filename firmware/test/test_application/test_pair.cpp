#include <unity.h>
#include "application/PairCoordinator.h"
#include "application/LogService.h"
#include "stubs.h"
using namespace feedme2;

namespace {
struct Rig {
    test::StubNetwork net; test::StubStorage store; test::StubClock clk; test::StubLogSink serial; test::StubFileQueue files; domain::ClockModel model;
    test::StubRandom rnd;
    application::LogService log{serial, files, clk, model};
    application::PairCoordinator pc{net, store, clk, rnd, log, "0123456789abcdef0123456789abcdef", "device-sim", "0.2.0"};
};
}  // namespace

void test_pair_start_pending_confirmed_persists_token() {
    Rig r;
    TEST_ASSERT_FALSE(r.pc.isPaired());
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"123456\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.pc.start();
    TEST_ASSERT_EQUAL(application::PairPhase::Pending, r.pc.view().phase);
    TEST_ASSERT_EQUAL_STRING("123456", r.pc.view().pairCode.c_str());
    TEST_ASSERT_TRUE(r.serial.lines.back().find("[feedme2] pair start code=123456") != std::string::npos);
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"pending\"}"));
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"confirmed\",\"deviceToken\":\"tok\",\"houseId\":\"h\",\"houseName\":\"H\",\"deviceName\":\"Kitchen\"}"));
    r.pc.tick(1000);                       // too early: no poll yet
    TEST_ASSERT_EQUAL_UINT32(2, r.net.pairCheckResults.size());
    r.pc.tick(3100);                       // first poll -> pending
    TEST_ASSERT_EQUAL(application::PairPhase::Pending, r.pc.view().phase);
    r.pc.tick(6200);                       // second poll -> confirmed
    TEST_ASSERT_EQUAL(application::PairPhase::Confirmed, r.pc.view().phase);
    TEST_ASSERT_TRUE(r.pc.isPaired());
    TEST_ASSERT_EQUAL_STRING("tok", r.store.kv["token"].c_str());
    TEST_ASSERT_EQUAL_STRING("Kitchen", r.store.kv["name"].c_str());
    TEST_ASSERT_EQUAL_STRING("tok", r.net.token.c_str());
    TEST_ASSERT_EQUAL_STRING("tok", r.pc.token().c_str());
    TEST_ASSERT_TRUE(r.serial.lines.back().find("[feedme2] paired house=h") != std::string::npos);
}

void test_pair_expired_restarts_and_transient_failure_retries() {
    Rig r;
    r.net.pairStartResults.push_back(test::StubNetwork::status(503));
    r.pc.start();
    TEST_ASSERT_EQUAL(application::PairPhase::Failed, r.pc.view().phase);
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"654321\",\"expiresAt\":1,\"pollAfterSec\":1}"));
    r.pc.tick(4900);                       // not yet
    TEST_ASSERT_EQUAL(application::PairPhase::Failed, r.pc.view().phase);
    r.pc.tick(5100);                       // retry after 5 s
    TEST_ASSERT_EQUAL(application::PairPhase::Pending, r.pc.view().phase);
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"expired\"}"));
    r.pc.tick(6200);
    TEST_ASSERT_EQUAL(application::PairPhase::Expired, r.pc.view().phase);
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"111111\",\"expiresAt\":1,\"pollAfterSec\":3}"));
    r.pc.tick(8300);                       // auto restart after 2 s
    TEST_ASSERT_EQUAL_STRING("111111", r.pc.view().pairCode.c_str());
}

void test_pair_poll_secret_is_identical_in_start_and_every_check_and_fresh_per_start() {
    Rig r;
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"123456\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.pc.start();
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"pending\"}"));
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"pending\"}"));
    r.pc.tick(3100); r.pc.tick(6200);
    TEST_ASSERT_EQUAL_UINT32(1, r.net.pairStarts.size());
    TEST_ASSERT_EQUAL_UINT32(32, r.net.pairStarts[0].pollSecret.size());
    TEST_ASSERT_EQUAL_UINT32(2, r.net.pairChecks.size());
    TEST_ASSERT_EQUAL_STRING(r.net.pairStarts[0].pollSecret.c_str(), r.net.pairChecks[0].pollSecret.c_str());
    TEST_ASSERT_EQUAL_STRING(r.net.pairStarts[0].pollSecret.c_str(), r.net.pairChecks[1].pollSecret.c_str());
    // The secret never touches storage: a reboot mid-pairing starts over.
    TEST_ASSERT_EQUAL_INT(0, r.store.writes);
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"654321\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.pc.start();                          // a restart draws a new secret
    TEST_ASSERT_TRUE(r.net.pairStarts[0].pollSecret != r.net.pairStarts[1].pollSecret);
}

void test_pair_unknown_restarts_like_expired() {
    Rig r;
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"123456\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.pc.start();
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"unknown\"}"));
    r.pc.tick(3100);
    TEST_ASSERT_EQUAL(application::PairPhase::Expired, r.pc.view().phase);
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"222222\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.pc.tick(5200);                       // auto restart after 2 s
    TEST_ASSERT_EQUAL_STRING("222222", r.pc.view().pairCode.c_str());
}

void test_pair_pending_for_ten_minutes_restarts_start() {
    Rig r;
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"123456\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.pc.start();
    for (uint32_t t = 3100; t <= 600000; t += 3100) { r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"pending\"}")); r.pc.tick(t); }
    TEST_ASSERT_EQUAL_UINT32(1, r.net.pairStarts.size());
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"333333\",\"expiresAt\":1200000,\"pollAfterSec\":3}"));
    r.pc.tick(601000);                     // 10 monotonic minutes of Pending: start over without trusting the server clock
    TEST_ASSERT_EQUAL_UINT32(2, r.net.pairStarts.size());
    TEST_ASSERT_EQUAL_STRING("333333", r.pc.view().pairCode.c_str());
}

void test_pair_permanent_400_on_check_is_failed() {
    Rig r;
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"123456\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.pc.start();
    r.net.pairCheckResults.push_back(test::StubNetwork::status(400, "{\"error\":\"invalid_request\"}"));
    r.pc.tick(3100);
    TEST_ASSERT_EQUAL(application::PairPhase::Failed, r.pc.view().phase);
    TEST_ASSERT_TRUE(r.pc.view().error.find("invalid_request") != std::string::npos);
    // The retry is a fresh start() with a new secret, not another check with the rejected one.
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"444444\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.pc.tick(8200);
    TEST_ASSERT_EQUAL_UINT32(2, r.net.pairStarts.size());
    TEST_ASSERT_TRUE(r.net.pairStarts[0].pollSecret != r.net.pairStarts[1].pollSecret);
}

void test_pair_unparsable_check_body_warns_and_keeps_polling() {
    Rig r;
    r.net.pairStartResults.push_back(test::StubNetwork::ok("{\"pairCode\":\"123456\",\"expiresAt\":600000,\"pollAfterSec\":3}"));
    r.pc.start();
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("<html>captive portal</html>"));
    r.pc.tick(3100);
    // The code stays on screen and the next poll still happens, but the field log says why nothing moved.
    TEST_ASSERT_EQUAL(application::PairPhase::Pending, r.pc.view().phase);
    TEST_ASSERT_EQUAL_STRING("warn pair check unparsable {\"status\":200}", r.serial.lines.back().c_str());
    r.net.pairCheckResults.push_back(test::StubNetwork::ok("{\"status\":\"pending\"}"));
    r.pc.tick(6200);
    TEST_ASSERT_EQUAL_UINT32(2, r.net.pairChecks.size());
    TEST_ASSERT_EQUAL(application::PairPhase::Pending, r.pc.view().phase);
}

void test_pair_clear_token() {
    Rig r;
    r.store.kv["token"] = "tok";
    r.store.kv["name"] = "Kitchen";
    TEST_ASSERT_TRUE(r.pc.isPaired());
    r.pc.clearToken();
    TEST_ASSERT_FALSE(r.pc.isPaired());
    TEST_ASSERT_EQUAL_STRING("", r.net.token.c_str());
    TEST_ASSERT_EQUAL_UINT32(0, r.store.kv.count("token"));
    TEST_ASSERT_EQUAL_UINT32(0, r.store.kv.count("name"));
    TEST_ASSERT_EQUAL(application::PairPhase::Idle, r.pc.view().phase);
}
