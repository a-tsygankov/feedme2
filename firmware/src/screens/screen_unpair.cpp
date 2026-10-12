#include "screens/Builders.h"

namespace feedme2::screens {

// The hold itself is drawn by the top-layer LongPressArcWidget; the App handles the LongPress
// (clear token → Pair) and the DoubleTap back.
void buildUnpair(application::App& app) {
    (void)app;
    lv_obj_t* scr = theme::freshScreen();
    theme::label(scr, "Hold to unpair", theme::font18(), theme::kText, LV_ALIGN_CENTER, 0, -14);
    theme::label(scr, "the device goes back to\nthe pairing screen", theme::font14(), theme::kDim, LV_ALIGN_CENTER, 0, 24, 200);
    theme::label(scr, "double-tap to go back", theme::font12(), theme::kDim, LV_ALIGN_BOTTOM_MID, 0, -24);
}

}  // namespace feedme2::screens
