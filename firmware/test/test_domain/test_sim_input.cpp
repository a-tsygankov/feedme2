#include <unity.h>

#include "domain/SimInput.h"

using feedme2::domain::SimEvent;
using feedme2::domain::parseSimCommand;
using feedme2::domain::simEventName;

void test_sim_input_parses_known_commands() {
    TEST_ASSERT_EQUAL(SimEvent::Press, parseSimCommand("press"));
    TEST_ASSERT_EQUAL(SimEvent::DoubleTap, parseSimCommand("double"));
    TEST_ASSERT_EQUAL(SimEvent::LongPress, parseSimCommand("long"));
    TEST_ASSERT_EQUAL(SimEvent::RotateCW, parseSimCommand("cw"));
    TEST_ASSERT_EQUAL(SimEvent::RotateCCW, parseSimCommand("ccw"));
    TEST_ASSERT_EQUAL(SimEvent::Touch, parseSimCommand("touch"));
}

void test_sim_input_is_case_insensitive_and_trims() {
    TEST_ASSERT_EQUAL(SimEvent::Press, parseSimCommand("  PRESS\r"));
    TEST_ASSERT_EQUAL(SimEvent::RotateCW, parseSimCommand("Cw \n"));
}

void test_sim_input_unknown_is_none() {
    TEST_ASSERT_EQUAL(SimEvent::None, parseSimCommand(""));
    TEST_ASSERT_EQUAL(SimEvent::None, parseSimCommand("jump"));
}

void test_sim_input_names_round_trip() {
    TEST_ASSERT_EQUAL_STRING("RotateCW", simEventName(SimEvent::RotateCW));
    TEST_ASSERT_EQUAL_STRING("Press", simEventName(SimEvent::Press));
    TEST_ASSERT_EQUAL_STRING("None", simEventName(SimEvent::None));
}
