#pragma once
// Internal to screens/: one build function per screen (howler style, no screen base class), each
// in its own screen_*.cpp, plus the helpers they share. Screens.cpp dispatches on the router.
#include <lvgl.h>

#include <cstdint>
#include <string>

#include "application/App.h"
#include "screens/Screens.h"
#include "screens/Theme.h"

namespace feedme2::screens {

const DeviceInfo& deviceInfo();

// `mg` in the house unit ("40 g", "1/4 can", "2.5 oz"); grams when no state has arrived yet.
std::string amountText(const application::App& app, int32_t mg);

void buildBoot(application::App& app);
void buildPair(application::App& app);
void buildIdle(application::App& app);
void buildAmount(application::App& app);
void buildFed(application::App& app);
void buildHistory(application::App& app);
void buildSystem(application::App& app);
void buildWifi(application::App& app);
void buildAbout(application::App& app);
void buildUnpair(application::App& app);

}  // namespace feedme2::screens
