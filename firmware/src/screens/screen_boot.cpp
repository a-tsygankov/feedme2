#include "application/Version.h"
#include "screens/Builders.h"

namespace feedme2::screens {

// Wordmark and version; App::begin() replaces it with Idle or Pair before the first frame unless
// the cached state is slow to load.
void buildBoot(application::App& app) {
    (void)app;
    lv_obj_t* scr = theme::freshScreen();
    theme::label(scr, "feedme2", theme::font24(), theme::kText, LV_ALIGN_CENTER, 0, -14);
    theme::label(scr, application::kFirmwareVersion, theme::font14(), theme::kDim, LV_ALIGN_CENTER, 0, 18);
}

}  // namespace feedme2::screens
