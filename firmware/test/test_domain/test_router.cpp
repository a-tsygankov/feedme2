#include <unity.h>
#include "domain/Router.h"
using namespace feedme2::domain;

void test_router_stack() {
    Router r;
    TEST_ASSERT_EQUAL(ScreenId::Boot, r.current());
    r.replaceRoot(ScreenId::Idle);
    TEST_ASSERT_TRUE(r.atRoot());
    r.push(ScreenId::System); r.push(ScreenId::WifiList);
    TEST_ASSERT_EQUAL(ScreenId::WifiList, r.current());
    TEST_ASSERT_TRUE(r.pop()); TEST_ASSERT_EQUAL(ScreenId::System, r.current());
    TEST_ASSERT_TRUE(r.pop()); TEST_ASSERT_FALSE(r.pop());
    TEST_ASSERT_EQUAL(ScreenId::Idle, r.current());
}

// Task 16: the names are the "[feedme2] screen=<name>" tokens the Wokwi scenarios wait for.
void test_router_screen_name_for_every_id() {
    TEST_ASSERT_EQUAL_STRING("boot", screenName(ScreenId::Boot));
    TEST_ASSERT_EQUAL_STRING("pair", screenName(ScreenId::Pair));
    TEST_ASSERT_EQUAL_STRING("idle", screenName(ScreenId::Idle));
    TEST_ASSERT_EQUAL_STRING("amount", screenName(ScreenId::Amount));
    TEST_ASSERT_EQUAL_STRING("fed", screenName(ScreenId::Fed));
    TEST_ASSERT_EQUAL_STRING("history", screenName(ScreenId::History));
    TEST_ASSERT_EQUAL_STRING("system", screenName(ScreenId::System));
    TEST_ASSERT_EQUAL_STRING("wifi", screenName(ScreenId::WifiList));
    TEST_ASSERT_EQUAL_STRING("about", screenName(ScreenId::About));
    TEST_ASSERT_EQUAL_STRING("unpair", screenName(ScreenId::UnpairConfirm));
    // An id outside the enum (a corrupt byte) prints "?" rather than reading past the table.
    TEST_ASSERT_EQUAL_STRING("?", screenName(static_cast<ScreenId>(200)));
}

// Fed is shown as replaceRoot(Idle) + push(Fed) from wherever the knob was: the stack collapses.
void test_router_replace_root_while_deep_collapses_the_stack() {
    Router r;
    r.replaceRoot(ScreenId::Idle);
    r.push(ScreenId::System); r.push(ScreenId::About);
    TEST_ASSERT_FALSE(r.atRoot());
    r.replaceRoot(ScreenId::Pair);
    TEST_ASSERT_TRUE(r.atRoot());
    TEST_ASSERT_EQUAL(ScreenId::Pair, r.current());
    TEST_ASSERT_FALSE(r.pop());
    TEST_ASSERT_EQUAL(ScreenId::Pair, r.current());
    r.push(ScreenId::Fed);
    TEST_ASSERT_FALSE(r.atRoot());
    TEST_ASSERT_TRUE(r.pop());
    TEST_ASSERT_EQUAL(ScreenId::Pair, r.current());
}
