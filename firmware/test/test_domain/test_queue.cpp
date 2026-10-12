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
    TEST_ASSERT_EQUAL_STRING("204", q.items().back().id.c_str());
}

// Task 16: replace() is what loadFromDisk() uses; head() is what a sync batch takes.
void test_queue_replace_and_head_bounds() {
    FeedingQueue q;
    TEST_ASSERT_TRUE(q.empty());
    TEST_ASSERT_TRUE(q.head(0).empty());
    TEST_ASSERT_TRUE(q.head(20).empty());
    q.push(d("a")); q.push(d("b")); q.push(d("c"));
    TEST_ASSERT_TRUE(q.head(0).empty());
    TEST_ASSERT_EQUAL_UINT32(3, q.head(20).size());   // asks for more than there is: all of it
    TEST_ASSERT_EQUAL_STRING("c", q.head(20)[2].id.c_str());
    q.removeIds({});
    TEST_ASSERT_EQUAL_UINT32(3, q.size());
    q.replace({d("x"), d("y")});
    TEST_ASSERT_EQUAL_UINT32(2, q.size());
    TEST_ASSERT_EQUAL_STRING("x", q.items()[0].id.c_str());
    TEST_ASSERT_EQUAL_STRING("y", q.items()[1].id.c_str());
    TEST_ASSERT_FALSE(q.empty());
    // The old ids are gone with the old items.
    q.removeIds({"a", "b", "c"});
    TEST_ASSERT_EQUAL_UINT32(2, q.size());
    q.replace({});
    TEST_ASSERT_TRUE(q.empty());
    TEST_ASSERT_TRUE(q.head(1).empty());
}
