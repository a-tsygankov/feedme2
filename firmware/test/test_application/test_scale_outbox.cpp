#include <unity.h>
#include <algorithm>
#include <string>
#include <ArduinoJson.h>
#include "application/ScaleOutbox.h"
#include "stubs.h"

using namespace feedme2::application;
using namespace feedme2::test;

namespace {
constexpr const char* kEpoch1 = "11111111-1111-4111-8111-111111111111";
constexpr const char* kEpoch2 = "22222222-2222-4222-8222-222222222222";
constexpr int64_t kUtc = 1792314000000LL;

struct FailFiles : StubFileQueue {
    bool failAppend = false;
    bool failRewrite = false;
    bool tailComplete = true;
    bool hasCompleteRecords(const char*) override { return tailComplete; }
    bool appendLine(const char* file, const std::string& line) override {
        return !failAppend && StubFileQueue::appendLine(file, line);
    }
    bool rewrite(const char* file, const std::vector<std::string>& lines) override {
        return !failRewrite && StubFileQueue::rewrite(file, lines);
    }
};
struct FailStorage : StubStorage {
    bool failWrite = false;
    bool write(const char* key, const std::string& value) override {
        return !failWrite && StubStorage::write(key, value);
    }
};
}

void test_scale_outbox_persists_exact_wire_contract() {
    StubFileQueue files;
    StubStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 2, 123456));
    auto batch = q.batch();
    TEST_ASSERT_EQUAL_UINT32(1, batch.size());
    TEST_ASSERT_EQUAL_UINT64(1, batch[0].sequence);
    JsonDocument doc;
    TEST_ASSERT_FALSE(deserializeJson(doc, q.encodeBatch(batch)));
    TEST_ASSERT_TRUE(doc.is<JsonArray>());
    JsonObjectConst e = doc[0].as<JsonObjectConst>();
    TEST_ASSERT_EQUAL_UINT32(6, e.size());
    TEST_ASSERT_EQUAL_STRING("stable_weight", e["kind"].as<const char*>());
    TEST_ASSERT_EQUAL_INT32(123456, e["grossMg"].as<int32_t>());
    TEST_ASSERT_FALSE(e.containsKey("deviceId"));
    TEST_ASSERT_FALSE(e.containsKey("houseId"));
    TEST_ASSERT_EQUAL_UINT32(1, files.appends);
}

void test_scale_outbox_reboot_preserves_queue_and_sequence() {
    StubFileQueue files;
    StubStorage storage;
    StubRandom rnd;
    {
        ScaleOutbox q(files, storage, rnd);
        TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
        TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::BowlRemoved, kUtc, 1));
    }
    ScaleOutbox reboot(files, storage, rnd);
    TEST_ASSERT_TRUE(reboot.activatePairing(kEpoch1));
    TEST_ASSERT_EQUAL_UINT32(1, reboot.pending());
    TEST_ASSERT_TRUE(reboot.enqueue(ScaleEventKind::BowlReturned, kUtc + 1000, 1, 40000));
    TEST_ASSERT_EQUAL_UINT64(2, reboot.batch()[1].sequence);
}

void test_scale_outbox_replay_201_with_empty_accepted_acknowledges_all() {
    StubFileQueue files;
    StubStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 1, 40000));
    const auto batch = q.batch();
    TEST_ASSERT_TRUE(q.acknowledge201(201, "{\"accepted\":[],\"now\":1792314000100}", batch));
    TEST_ASSERT_EQUAL_UINT32(0, q.pending());
    ScaleOutbox reboot(files, storage, rnd);
    TEST_ASSERT_TRUE(reboot.activatePairing(kEpoch1));
    TEST_ASSERT_EQUAL_UINT32(0, reboot.pending());
}

void test_scale_outbox_201_subset_accepted_also_acks_replays() {
    StubFileQueue files;
    StubStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 1, 40000));
    TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::BowlRemoved, kUtc + 1000, 1));
    const auto batch = q.batch();
    const auto response = std::string("{\"accepted\":[\"") + batch[0].id + "\"],\"now\":1792314000100}";
    TEST_ASSERT_TRUE(q.acknowledge201(201, response, batch));
    TEST_ASSERT_EQUAL_UINT32(0, q.pending());
}

void test_scale_outbox_never_drops_on_network_or_protocol_failure() {
    StubFileQueue files;
    StubStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 1, 40000));
    const auto batch = q.batch();
    for (int status : {0, 200, 400, 401, 409, 429, 500}) {
        TEST_ASSERT_FALSE(q.acknowledge201(status, "{\"accepted\":[],\"now\":1792314000100}", batch));
        TEST_ASSERT_EQUAL_UINT32(1, q.pending());
    }
    TEST_ASSERT_FALSE(q.acknowledge201(201, "not json", batch));
    TEST_ASSERT_FALSE(q.acknowledge201(201, "{\"accepted\":[],\"now\":null}", batch));
    TEST_ASSERT_FALSE(q.acknowledge201(201, "{\"accepted\":[\"foreign\"],\"now\":1792314000100}", batch));
    TEST_ASSERT_EQUAL_UINT32(1, q.pending());
}

void test_scale_outbox_pairing_epoch_isolates_previous_house_events() {
    StubFileQueue files;
    StubStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 1, 40000));
    const std::string oldFile = q.filePath();
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch2));
    TEST_ASSERT_EQUAL_UINT32(0, q.pending());
    TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::BowlRemoved, kUtc + 1000, 1));
    TEST_ASSERT_EQUAL_UINT64(1, q.batch()[0].sequence);
    TEST_ASSERT_EQUAL_UINT32(1, files.files[oldFile].size());
    TEST_ASSERT_NOT_EQUAL(0, oldFile.compare(q.filePath()));
}

void test_scale_outbox_sequence_reservation_survives_append_failure() {
    FailFiles files;
    StubStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    files.failAppend = true;
    TEST_ASSERT_FALSE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 1, 40000));
    TEST_ASSERT_FALSE(q.active());
    files.failAppend = false;
    ScaleOutbox reboot(files, storage, rnd);
    TEST_ASSERT_TRUE(reboot.activatePairing(kEpoch1));
    TEST_ASSERT_TRUE(reboot.enqueue(ScaleEventKind::StableWeight, kUtc, 1, 40000));
    TEST_ASSERT_EQUAL_UINT64(2, reboot.batch()[0].sequence);
}

void test_scale_outbox_nvs_write_failure_disables_appending() {
    StubFileQueue files;
    FailStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    storage.failWrite = true;
    TEST_ASSERT_FALSE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 1, 40000));
    TEST_ASSERT_FALSE(q.active());
    TEST_ASSERT_EQUAL_UINT32(0, files.appends);
}

void test_scale_outbox_corrupt_jsonl_fails_closed() {
    StubFileQueue files;
    StubStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    const std::string path = q.filePath();
    files.files[path].push_back("{broken");
    ScaleOutbox reboot(files, storage, rnd);
    TEST_ASSERT_FALSE(reboot.activatePairing(kEpoch1));
    TEST_ASSERT_FALSE(reboot.enqueue(ScaleEventKind::StableWeight, kUtc, 1, 40000));
    TEST_ASSERT_EQUAL_UINT32(1, files.files[path].size());
}

void test_scale_outbox_invalid_events_are_never_persisted() {
    StubFileQueue files;
    StubStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    TEST_ASSERT_FALSE(q.enqueue(ScaleEventKind::StableWeight, 0, 1, 40000));
    TEST_ASSERT_FALSE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 0, 40000));
    TEST_ASSERT_FALSE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 1, -1));
    TEST_ASSERT_FALSE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 1, 1000001));
    TEST_ASSERT_FALSE(q.enqueue(ScaleEventKind::SensorFault, kUtc, 1, 0, "invalid"));
    TEST_ASSERT_FALSE(q.enqueue(ScaleEventKind::BowlRemoved, kUtc, 1, 100));
    TEST_ASSERT_EQUAL_UINT32(0, q.pending());
    TEST_ASSERT_EQUAL_UINT32(0, files.appends);
}

void test_scale_outbox_batch_caps_at_fifty() {
    StubFileQueue files;
    StubStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    for (int i = 0; i < 55; ++i)
        TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::BowlRemoved, kUtc + i, 1));
    TEST_ASSERT_EQUAL_UINT32(50, q.batch().size());
    TEST_ASSERT_EQUAL_UINT32(10, q.batch(10).size());
    TEST_ASSERT_EQUAL_STRING("", q.encodeBatch({}).c_str());
}

void test_scale_outbox_failed_compaction_keeps_all_pending() {
    FailFiles files;
    StubStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 1, 40000));
    files.failRewrite = true;
    TEST_ASSERT_FALSE(q.acknowledge201(201, "{\"accepted\":[],\"now\":1792314000100}", q.batch()));
    TEST_ASSERT_EQUAL_UINT32(1, q.pending());
    files.failRewrite = false;
    TEST_ASSERT_TRUE(q.acknowledge201(201, "{\"accepted\":[],\"now\":1792314000100}", q.batch()));
    TEST_ASSERT_EQUAL_UINT32(0, q.pending());
}

void test_scale_outbox_rejects_wrong_batch_prefix() {
    StubFileQueue files;
    StubStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 1, 40000));
    TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::BowlRemoved, kUtc + 1, 1));
    auto wrong = q.batch();
    std::swap(wrong[0], wrong[1]);
    TEST_ASSERT_FALSE(q.acknowledge201(201, "{\"accepted\":[],\"now\":1792314000100}", wrong));
    TEST_ASSERT_EQUAL_UINT32(2, q.pending());
}

void test_scale_outbox_partial_nvs_loss_fails_closed() {
    StubFileQueue files;
    StubStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 1, 40000));
    storage.kv.erase(ScaleOutbox::kSequenceKey);
    ScaleOutbox reboot(files, storage, rnd);
    TEST_ASSERT_FALSE(reboot.activatePairing(kEpoch1));
    TEST_ASSERT_EQUAL_UINT32(1, files.files[q.filePath()].size());
}

void test_scale_outbox_unterminated_tail_fails_closed() {
    FailFiles files;
    StubStorage storage;
    StubRandom rnd;
    ScaleOutbox q(files, storage, rnd);
    TEST_ASSERT_TRUE(q.activatePairing(kEpoch1));
    TEST_ASSERT_TRUE(q.enqueue(ScaleEventKind::StableWeight, kUtc, 1, 40000));
    files.tailComplete = false;
    ScaleOutbox reboot(files, storage, rnd);
    TEST_ASSERT_FALSE(reboot.activatePairing(kEpoch1));
    TEST_ASSERT_EQUAL_UINT32(1, files.files[q.filePath()].size());
}
