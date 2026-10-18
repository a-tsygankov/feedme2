#include <unity.h>
#include <ArduinoJson.h>
#include <deque>
#include <string>
#include <vector>
#include "application/ScaleNetService.h"
#include "stubs.h"

using namespace feedme2::application;
using namespace feedme2::test;
using feedme2::ports::NetResult;
using feedme2::ports::IScaleTransport;

namespace {
constexpr const char* kDevice = "0123456789abcdef0123456789abcdef";
constexpr int64_t kUtc = 1792314000000LL;
const std::string kStart = "{\"pairCode\":\"123456\",\"expiresAt\":1792314000000,\"pollAfterSec\":3}";
const std::string kConfirmed = "{\"status\":\"confirmed\",\"deviceToken\":\"signed-token\",\"houseId\":\"house1\",\"houseName\":\"Home\",\"deviceName\":\"Scale\"}";

struct FakeScaleNet : IScaleTransport {
    bool online = true;
    std::deque<NetResult> starts, checks, uploads;
    std::vector<std::string> bodies, authTokens, pollSecrets;
    int startCalls = 0, checkCalls = 0;
    bool isOnline() const override { return online; }
    NetResult pairStart(const std::string&, const std::string&, const std::string& secret) override {
        ++startCalls;
        pollSecrets.push_back(secret);
        if (starts.empty()) return NetResult::fromStatus(0, "offline");
        const auto r = starts.front(); starts.pop_front(); return r;
    }
    NetResult pairCheck(const std::string&, const std::string& secret) override {
        ++checkCalls;
        pollSecrets.push_back(secret);
        if (checks.empty()) return NetResult::fromStatus(0, "offline");
        const auto r = checks.front(); checks.pop_front(); return r;
    }
    NetResult postScaleEvents(const std::string& token, const std::string& json) override {
        authTokens.push_back(token);
        bodies.push_back(json);
        if (uploads.empty()) return NetResult::fromStatus(0, "offline");
        const auto r = uploads.front(); uploads.pop_front(); return r;
    }
};

struct Fixture {
    StubFileQueue files;
    StubStorage storage;
    StubRandom random;
    FakeScaleNet net;
    ScaleOutbox outbox{files, storage, random};
    ScaleNetService service{net, storage, random, outbox, kDevice, "0.1.39"};
    bool pair() {
        net.starts.push_back(NetResult::fromStatus(200, kStart));
        net.checks.push_back(NetResult::fromStatus(200, kConfirmed));
        if (!service.startPairing(0)) return false;
        service.tick(3000);
        return service.paired();
    }
};
}

void test_scale_net_pairing_stores_auth_and_never_prints_token() {
    Fixture f;
    TEST_ASSERT_TRUE(f.service.restore());
    TEST_ASSERT_TRUE(f.pair());
    TEST_ASSERT_FALSE(f.service.pairing());
    TEST_ASSERT_EQUAL_STRING("", f.service.pairCode().c_str());
    TEST_ASSERT_EQUAL_STRING(f.net.pollSecrets[0].c_str(), f.net.pollSecrets[1].c_str());
    std::string blob;
    TEST_ASSERT_TRUE(f.storage.read(ScaleNetService::kAuthKey, blob));
    JsonDocument doc;
    TEST_ASSERT_FALSE(deserializeJson(doc, blob));
    TEST_ASSERT_EQUAL_STRING(kDevice, doc["deviceId"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("signed-token", doc["token"].as<const char*>());
    TEST_ASSERT_TRUE(f.outbox.active());
}

void test_scale_net_restore_uses_same_epoch_after_reboot() {
    Fixture f;
    TEST_ASSERT_TRUE(f.pair());
    TEST_ASSERT_TRUE(f.service.enqueueStable(kUtc, 1, 123000));
    const std::string path = f.outbox.filePath();
    ScaleOutbox restoredOutbox(f.files, f.storage, f.random);
    ScaleNetService restored(f.net, f.storage, f.random, restoredOutbox, kDevice, "0.1.39");
    TEST_ASSERT_TRUE(restored.restore());
    TEST_ASSERT_TRUE(restored.paired());
    TEST_ASSERT_EQUAL_STRING(path.c_str(), restoredOutbox.filePath().c_str());
    TEST_ASSERT_EQUAL_UINT32(1, restored.pending());
}

void test_scale_net_upload_acknowledges_replay_only_on_201() {
    Fixture f;
    TEST_ASSERT_TRUE(f.pair());
    TEST_ASSERT_TRUE(f.service.enqueueStable(kUtc, 1, 123000));
    f.net.uploads.push_back(NetResult::fromStatus(500, "server error"));
    f.service.tick(60000);
    TEST_ASSERT_EQUAL_UINT32(1, f.service.pending());
    f.net.uploads.push_back(NetResult::fromStatus(201, "{\"accepted\":[],\"now\":1792314000000}"));
    f.service.tick(120000);
    TEST_ASSERT_EQUAL_UINT32(0, f.service.pending());
    TEST_ASSERT_EQUAL_STRING("signed-token", f.net.authTokens[0].c_str());
    TEST_ASSERT_EQUAL_UINT32(2, f.net.bodies.size());
    TEST_ASSERT_EQUAL_STRING(f.net.bodies[0].c_str(), f.net.bodies[1].c_str());
}

void test_scale_net_pair_code_not_a_token() {
    Fixture f;
    f.net.starts.push_back(NetResult::fromStatus(200, kStart));
    f.net.checks.push_back(NetResult::fromStatus(200, "{\"status\":\"pending\"}"));
    TEST_ASSERT_TRUE(f.service.startPairing(1000));
    TEST_ASSERT_EQUAL_STRING("123456", f.service.pairCode().c_str());
    TEST_ASSERT_FALSE(f.service.paired());
    f.service.tick(4000);
    TEST_ASSERT_FALSE(f.service.paired());
    TEST_ASSERT_TRUE(f.service.pairing());
    TEST_ASSERT_EQUAL_UINT32(0, f.net.authTokens.size());
}

void test_scale_net_rejects_invalid_pair_start() {
    Fixture f;
    f.net.starts.push_back(NetResult::fromStatus(200, "{\"pairCode\":\"hello\",\"pollAfterSec\":3}"));
    TEST_ASSERT_FALSE(f.service.startPairing(0));
    TEST_ASSERT_FALSE(f.service.pairing());
    TEST_ASSERT_FALSE(f.service.paired());
}

void test_scale_net_unpair_quarantines_old_events() {
    Fixture f;
    TEST_ASSERT_TRUE(f.pair());
    TEST_ASSERT_TRUE(f.service.enqueueStable(kUtc, 1, 123000));
    const auto oldFile = f.outbox.filePath();
    TEST_ASSERT_TRUE(f.service.unpair());
    TEST_ASSERT_FALSE(f.service.paired());
    TEST_ASSERT_FALSE(f.service.enqueueStable(kUtc + 1, 1, 123001));
    TEST_ASSERT_TRUE(f.pair());
    TEST_ASSERT_EQUAL_UINT32(0, f.service.pending());
    TEST_ASSERT_NOT_EQUAL(0, oldFile.compare(f.outbox.filePath()));
    TEST_ASSERT_EQUAL_UINT32(1, f.files.files[oldFile].size());
}

void test_scale_net_401_unpairs_without_deleting_old_queue() {
    Fixture f;
    TEST_ASSERT_TRUE(f.pair());
    TEST_ASSERT_TRUE(f.service.enqueueStable(kUtc, 1, 123000));
    const auto oldFile = f.outbox.filePath();
    f.net.uploads.push_back(NetResult::fromStatus(401, "{\"error\":\"unauthorized\"}"));
    f.service.tick(60000);
    TEST_ASSERT_FALSE(f.service.paired());
    TEST_ASSERT_EQUAL_UINT32(1, f.files.files[oldFile].size());
    TEST_ASSERT_EQUAL_STRING("token_revoked", f.service.lastError().c_str());
}

void test_scale_net_409_blocks_until_operator_unpairs() {
    Fixture f;
    TEST_ASSERT_TRUE(f.pair());
    TEST_ASSERT_TRUE(f.service.enqueueStable(kUtc, 1, 123000));
    f.net.uploads.push_back(NetResult::fromStatus(409, "{\"error\":\"event_conflict\"}"));
    f.service.tick(60000);
    TEST_ASSERT_TRUE(f.service.blocked());
    TEST_ASSERT_EQUAL_UINT32(1, f.service.pending());
    f.service.tick(120000);
    TEST_ASSERT_EQUAL_UINT32(1, f.net.bodies.size());
    TEST_ASSERT_FALSE(f.service.enqueueStable(kUtc + 1, 1, 123000));
}

void test_scale_net_malformed_201_retains_queue() {
    Fixture f;
    TEST_ASSERT_TRUE(f.pair());
    TEST_ASSERT_TRUE(f.service.enqueueStable(kUtc, 1, 123000));
    f.net.uploads.push_back(NetResult::fromStatus(201, "{\"accepted\":[\"not-an-id\"],\"now\":1792314000000}"));
    f.service.tick(60000);
    TEST_ASSERT_EQUAL_UINT32(1, f.service.pending());
    TEST_ASSERT_EQUAL_STRING("ack_invalid", f.service.lastError().c_str());
}

void test_scale_net_offline_does_not_poll_or_upload() {
    Fixture f;
    TEST_ASSERT_TRUE(f.pair());
    TEST_ASSERT_TRUE(f.service.enqueueStable(kUtc, 1, 123000));
    f.net.online = false;
    f.service.tick(60000);
    TEST_ASSERT_EQUAL_UINT32(0, f.net.bodies.size());
    TEST_ASSERT_EQUAL_UINT32(1, f.service.pending());
}

void test_scale_net_refuses_invalid_time_or_calibration() {
    Fixture f;
    TEST_ASSERT_TRUE(f.pair());
    TEST_ASSERT_FALSE(f.service.enqueueStable(0, 1, 123000));
    TEST_ASSERT_FALSE(f.service.enqueueStable(kUtc, 0, 123000));
    TEST_ASSERT_FALSE(f.service.enqueueStable(kUtc, 1, -1));
    TEST_ASSERT_EQUAL_UINT32(0, f.service.pending());
}

void test_scale_net_refuses_corrupt_saved_identity() {
    Fixture f;
    f.storage.write(ScaleNetService::kAuthKey,
        "{\"deviceId\":\"different\",\"token\":\"signed-token\",\"epoch\":\"11111111-1111-4111-8111-111111111111\"}");
    TEST_ASSERT_FALSE(f.service.restore());
    TEST_ASSERT_FALSE(f.service.paired());
    TEST_ASSERT_EQUAL_UINT32(0, f.net.bodies.size());
}

void test_scale_net_bowl_transitions_are_events_not_feedings() {
    Fixture f;
    TEST_ASSERT_TRUE(f.pair());
    TEST_ASSERT_TRUE(f.service.enqueueBowlTransition(false, kUtc, 1, 0));
    TEST_ASSERT_TRUE(f.service.enqueueBowlTransition(true, kUtc + 3000, 1, 155000));
    TEST_ASSERT_EQUAL_UINT32(2, f.service.pending());
    const auto batch = f.outbox.batch();
    TEST_ASSERT_EQUAL(ScaleEventKind::BowlRemoved, batch[0].kind);
    TEST_ASSERT_EQUAL(ScaleEventKind::BowlReturned, batch[1].kind);
    const auto body = f.outbox.encodeBatch(batch);
    JsonDocument doc;
    TEST_ASSERT_FALSE(deserializeJson(doc, body));
    TEST_ASSERT_EQUAL_STRING("bowl_removed", doc[0]["kind"].as<const char*>());
    TEST_ASSERT_EQUAL_STRING("bowl_returned", doc[1]["kind"].as<const char*>());
    TEST_ASSERT_EQUAL_INT32(155000, doc[1]["grossMg"].as<int32_t>());
    TEST_ASSERT_FALSE(doc[0]["grossMg"].is<int32_t>());
    TEST_ASSERT_FALSE(f.service.enqueueBowlTransition(true, kUtc, 0, 155000));
    TEST_ASSERT_FALSE(f.service.enqueueBowlTransition(true, kUtc, 1, -1));
    f.net.uploads.push_back(NetResult::fromStatus(201, "{\"accepted\":[],\"now\":1792314000000}"));
    f.service.syncNow(10000);
    TEST_ASSERT_EQUAL_UINT32(0, f.service.pending());
    TEST_ASSERT_EQUAL_STRING(body.c_str(), f.net.bodies[0].c_str());
}
