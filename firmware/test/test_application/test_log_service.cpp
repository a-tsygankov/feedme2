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

// The file is only compacted once it holds twice the cap: rewriting 300 lines on every log past
// the cap would wear LittleFS on a device stuck offline, but letting it grow unbounded would too.
void test_log_service_compacts_file_once_it_holds_twice_the_cap() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; domain::ClockModel model;
    application::LogService log(serial, files, clk, model);
    for (int i = 0; i < 600; ++i) log.info("spam");
    TEST_ASSERT_EQUAL_INT(0, files.rewrites);
    TEST_ASSERT_EQUAL_UINT32(600, files.files["/logs.jsonl"].size());
    log.info("one past twice the cap");
    TEST_ASSERT_EQUAL_INT(1, files.rewrites);
    TEST_ASSERT_EQUAL_UINT32(300, files.files["/logs.jsonl"].size());
    TEST_ASSERT_EQUAL_UINT32(300, log.pending());
}

// Lines already on disk at boot count towards the compaction threshold; otherwise a device that
// reboots every few hundred lines would never compact and the file would grow without bound.
void test_log_service_compaction_counts_lines_loaded_from_disk() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; domain::ClockModel model;
    {
        application::LogService log(serial, files, clk, model);
        for (int i = 0; i < 599; ++i) log.info("spam");
        TEST_ASSERT_EQUAL_INT(0, files.rewrites);
    }
    application::LogService again(serial, files, clk, model);
    again.loadFromDisk();
    again.info("600th line");
    TEST_ASSERT_EQUAL_INT(0, files.rewrites);
    again.info("601st line");
    TEST_ASSERT_EQUAL_INT(1, files.rewrites);
    TEST_ASSERT_EQUAL_UINT32(300, files.files["/logs.jsonl"].size());
}

// A sync round with nothing to upload must not cost a flash rewrite.
void test_log_service_idle_take_batch_does_not_rewrite_the_file() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; domain::ClockModel model;
    application::LogService log(serial, files, clk, model);
    log.info("one");
    TEST_ASSERT_EQUAL_UINT32(1, log.takeBatch(50).size());
    TEST_ASSERT_EQUAL_INT(1, files.rewrites);
    TEST_ASSERT_TRUE(log.takeBatch(50).empty());
    TEST_ASSERT_EQUAL_INT(1, files.rewrites);
}

// A 2-byte character straddling the 500-byte cut is dropped whole: a lone lead byte would make
// the JSON line invalid UTF-8 and the server would reject the entire batch.
void test_log_service_msg_clamp_does_not_split_a_utf8_sequence() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; domain::ClockModel model;
    application::LogService log(serial, files, clk, model);
    // bytes 0..498 are 'x', byte 499 is the lead byte of "é" (C3 A9), byte 500 its continuation.
    const std::string msg = std::string(499, 'x') + "\xC3\xA9" + std::string(50, 'x');
    log.info(msg.c_str());
    auto batch = log.takeBatch(50);
    JsonDocument d; TEST_ASSERT_FALSE(deserializeJson(d, batch[0]));
    const std::string out = d["msg"].as<const char*>();
    TEST_ASSERT_TRUE(out.size() <= application::LogService::kMaxMsgChars);
    TEST_ASSERT_EQUAL_UINT32(499, out.size());
    TEST_ASSERT_EQUAL_HEX8('x', static_cast<unsigned char>(out.back()));
    // Valid UTF-8: no byte of the result is a lead byte (>= 0xC0) left without its continuation.
    for (size_t i = 0; i < out.size(); ++i) TEST_ASSERT_TRUE((static_cast<unsigned char>(out[i]) & 0x80) == 0);
}
