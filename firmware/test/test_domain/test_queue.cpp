#include <unity.h>
#include "domain/FeedingQueue.h"
using namespace feedme2::domain;

static FeedingDraft d(const char* id) { FeedingDraft x; x.id = id; x.catId = "c"; x.amountMg = 1000; x.unit = FoodUnit::Grams; x.enteredValue = "1"; x.fedAtMs = 1; return x; }

void test_queue_fifo_head_and_remove_by_id() {
    FeedingQueue q;
    q.push(d("a")); q.push(d("b")); q.push(d("c"));
    auto h = q.head(2);
    TEST_ASSERT_EQUAL_UINT32(2, h.size());
    TEST_ASSERT_EQUAL_STRING("a", h[0].id.c_str());
    q.removeIds({"a", "zzz"});
    TEST_ASSERT_EQUAL_UINT32(2, q.size());
    TEST_ASSERT_EQUAL_STRING("b", q.items()[0].id.c_str());
}

void test_queue_drops_oldest_past_cap() {
    FeedingQueue q;
    for (size_t i = 0; i < FeedingQueue::kCap + 5; ++i) q.push(d(std::to_string(i).c_str()));
    TEST_ASSERT_EQUAL_UINT32(FeedingQueue::kCap, q.size());
    TEST_ASSERT_EQUAL_STRING("5", q.items()[0].id.c_str());
}
