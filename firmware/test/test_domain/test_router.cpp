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
