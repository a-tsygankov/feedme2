#include <unity.h>
#include "domain/CatRoster.h"
using namespace feedme2::domain;

static DeviceState twoCats() {
    DeviceState s;
    CatState a; a.id = "a"; a.name = "Mochi"; a.sortOrder = 1;
    CatState b; b.id = "b"; b.name = "Luna"; b.sortOrder = 0;
    s.cats = {a, b};
    return s;
}

void test_roster_sorts_and_adds_all_for_two_cats() {
    CatRoster r; r.setState(twoCats());
    TEST_ASSERT_EQUAL_UINT32(3, r.count());
    TEST_ASSERT_TRUE(r.hasAll());
    TEST_ASSERT_EQUAL_STRING("Luna", r.selected()->name.c_str());
    r.rotate(1); TEST_ASSERT_EQUAL_STRING("Mochi", r.selected()->name.c_str());
    r.rotate(1); TEST_ASSERT_TRUE(r.isAllSelected()); TEST_ASSERT_NULL(r.selected());
    r.rotate(1); TEST_ASSERT_EQUAL_STRING("Luna", r.selected()->name.c_str());
    r.rotate(-1); TEST_ASSERT_TRUE(r.isAllSelected());
}

void test_roster_single_cat_has_no_all_and_keeps_selection_across_state_updates() {
    CatRoster r;
    DeviceState one = twoCats(); one.cats.pop_back();
    r.setState(one);
    TEST_ASSERT_EQUAL_UINT32(1, r.count());
    TEST_ASSERT_FALSE(r.hasAll());
    r.rotate(5); TEST_ASSERT_EQUAL_STRING("Mochi", r.selected()->name.c_str());
    DeviceState two = twoCats();
    r.setState(two);
    TEST_ASSERT_EQUAL_STRING("Mochi", r.selected()->name.c_str());  // same id re-selected, not index 0
    r.selectById("zzz"); TEST_ASSERT_EQUAL_STRING("Mochi", r.selected()->name.c_str());
}

// Task 16: a house with no cats (first boot, or the state erased by a 401) must not crash the knob.
void test_roster_empty_has_nothing_selected_and_rotate_is_safe() {
    CatRoster r;
    TEST_ASSERT_EQUAL_UINT32(0, r.count());
    TEST_ASSERT_FALSE(r.hasAll());
    TEST_ASSERT_FALSE(r.isAllSelected());
    TEST_ASSERT_NULL(r.selected());
    r.rotate(1); r.rotate(-1); r.rotate(-1000);
    r.selectById("a");
    TEST_ASSERT_EQUAL_UINT32(0, r.index());
    TEST_ASSERT_NULL(r.selected());
    // Cats arriving later land on the first one; the "All" entry was never selected while empty.
    r.setState(twoCats());
    TEST_ASSERT_EQUAL_UINT32(0, r.index());
    TEST_ASSERT_EQUAL_STRING("Luna", r.selected()->name.c_str());
    // And going back to no cats forgets the selection without an out-of-range index.
    r.rotate(2);
    TEST_ASSERT_TRUE(r.isAllSelected());
    r.setState(DeviceState{});
    TEST_ASSERT_EQUAL_UINT32(0, r.index());
    TEST_ASSERT_FALSE(r.isAllSelected());
    TEST_ASSERT_NULL(r.selected());
}

void test_roster_rotate_by_large_negative_wraps() {
    CatRoster r; r.setState(twoCats());   // Luna, Mochi, All
    r.rotate(-7);                          // -7 mod 3 = 2
    TEST_ASSERT_TRUE(r.isAllSelected());
    r.rotate(-3000);                       // a whole number of laps
    TEST_ASSERT_TRUE(r.isAllSelected());
    r.rotate(-4);                          // 2 - 4 = -2 -> 1
    TEST_ASSERT_EQUAL_STRING("Mochi", r.selected()->name.c_str());
    r.rotate(1000);                        // 1 + 1000 = 1001 mod 3 = 2
    TEST_ASSERT_TRUE(r.isAllSelected());
    r.rotate(-2);
    TEST_ASSERT_EQUAL_STRING("Luna", r.selected()->name.c_str());
    // Ties in sortOrder fall back to the id so two states with the same cats always agree.
    DeviceState tie = twoCats(); tie.cats[0].sortOrder = 0;   // "a" Mochi and "b" Luna both 0
    r.setState(tie);
    TEST_ASSERT_EQUAL_STRING("Luna", r.selected()->name.c_str());   // kept by id across the re-sort
    TEST_ASSERT_EQUAL_STRING("Mochi", r.cats()[0].name.c_str());
    TEST_ASSERT_EQUAL_STRING("Luna", r.cats()[1].name.c_str());
    TEST_ASSERT_EQUAL_UINT32(1, r.index());
}
