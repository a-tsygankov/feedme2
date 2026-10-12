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
