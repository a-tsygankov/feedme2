#include <unity.h>
#include "application/FeedingService.h"
#include "application/LogService.h"
#include "stubs.h"
using namespace feedme2;

static domain::DeviceState oneCat() { domain::DeviceState s; domain::CatState c; c.id = "cat-a"; c.name = "Mochi"; c.hasDefault = true; c.defaultAmountMg = 40000; c.defaultUnit = domain::FoodUnit::Grams; c.defaultValue = "40"; s.cats = {c}; return s; }

void test_feeding_service_commit_persists_and_survives_reload() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; test::StubRandom rnd; domain::ClockModel model;
    application::LogService log(serial, files, clk, model);
    auto s = oneCat();
    {
        application::FeedingService svc(files, rnd, model, log);
        domain::FeedFlow flow; flow.begin(s, &s.cats[0], 0);
        auto drafts = svc.commit(flow, 1700000000000LL);
        TEST_ASSERT_EQUAL_UINT32(1, drafts.size());
        TEST_ASSERT_EQUAL_UINT32(1, svc.queue().size());
        TEST_ASSERT_EQUAL_UINT32(1, files.files["/feedings.jsonl"].size());
        TEST_ASSERT_TRUE(serial.lines.back().find("[feedme2] feeding queued id=") != std::string::npos);
    }
    application::FeedingService again(files, rnd, model, log);
    again.loadFromDisk();
    TEST_ASSERT_EQUAL_UINT32(1, again.queue().size());
    again.markAccepted({again.queue().items()[0].id});
    TEST_ASSERT_TRUE(again.queue().empty());
    TEST_ASSERT_EQUAL_UINT32(0, files.files["/feedings.jsonl"].size());
}

void test_feeding_service_keeps_last_five_for_history() {
    test::StubLogSink serial; test::StubFileQueue files; test::StubClock clk; test::StubRandom rnd; domain::ClockModel model;
    application::LogService log(serial, files, clk, model);
    application::FeedingService svc(files, rnd, model, log);
    auto s = oneCat();
    for (int i = 0; i < 7; ++i) { domain::FeedFlow f; f.begin(s, &s.cats[0], 0); svc.commit(f, 1000 + i); }
    auto r = svc.recent(5);
    TEST_ASSERT_EQUAL_UINT32(5, r.size());
    TEST_ASSERT_EQUAL_INT64(1006, r[0].fedAtMs);  // newest first
}
