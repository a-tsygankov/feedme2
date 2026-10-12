#include <unity.h>
#include <ArduinoJson.h>
#include "application/LogService.h"
#include "stubs.h"
using namespace feedme2;

void test_log_service_event_prints_machine_line_and_queues_upload() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; domain::ClockModel model;
    application::LogService log(serial, files, clk, model);
    log.event("idle", "cat=Mochi level=content");
    TEST_ASSERT_EQUAL_UINT32(1, serial.lines.size());
    TEST_ASSERT_EQUAL_STRING("info [feedme2] idle cat=Mochi level=content", serial.lines[0].c_str());
    TEST_ASSERT_EQUAL_UINT32(1, log.pending());
    TEST_ASSERT_EQUAL_INT(1, files.appends);
    auto batch = log.takeBatch(50);
    TEST_ASSERT_EQUAL_UINT32(1, batch.size());
    TEST_ASSERT_EQUAL_UINT32(0, log.pending());
    TEST_ASSERT_EQUAL_INT(1, files.rewrites);
    log.requeue(batch);
    TEST_ASSERT_EQUAL_UINT32(1, log.pending());
}

void test_log_service_caps_disk_lines_and_reloads() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; domain::ClockModel model;
    {
        application::LogService log(serial, files, clk, model);
        for (int i = 0; i < 350; ++i) log.info("spam");
        TEST_ASSERT_EQUAL_UINT32(300, log.pending());
    }
    application::LogService again(serial, files, clk, model);
    again.loadFromDisk();
    TEST_ASSERT_EQUAL_UINT32(300, again.pending());
}

// LogEntrySchema caps msg at 500 chars; a longer one would 400 the whole batch as Permanent.
void test_log_service_truncates_msg_to_server_cap() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; domain::ClockModel model;
    application::LogService log(serial, files, clk, model);
    log.warn(std::string(700, 'x').c_str(), "{\"k\":1}");
    auto batch = log.takeBatch(50);
    JsonDocument d; TEST_ASSERT_FALSE(deserializeJson(d, batch[0]));
    TEST_ASSERT_EQUAL_UINT32(500, std::string(d["msg"].as<const char*>()).size());
    TEST_ASSERT_EQUAL_STRING("warn", d["level"]);
    TEST_ASSERT_EQUAL_INT(1, d["data"]["k"].as<int>());
}

// LogsUploadBodySchema refines data to 1 KB serialized; one oversize entry 400s the batch (Permanent).
void test_log_service_drops_data_over_one_kb() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; domain::ClockModel model;
    application::LogService log(serial, files, clk, model);
    const std::string big = "{\"blob\":\"" + std::string(1100, 'y') + "\"}";
    log.info("big", big.c_str());
    log.info("small", "{\"k\":2}");
    auto batch = log.takeBatch(50);
    JsonDocument d; TEST_ASSERT_FALSE(deserializeJson(d, batch[0]));
    TEST_ASSERT_FALSE(d["data"].is<JsonObject>());
    TEST_ASSERT_EQUAL_STRING("big", d["msg"]);
    TEST_ASSERT_FALSE(deserializeJson(d, batch[1]));
    TEST_ASSERT_EQUAL_INT(2, d["data"]["k"].as<int>());
}
