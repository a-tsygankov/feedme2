#include <string>

#include "screens/Builders.h"
#include "screens/components/CatImage.h"

namespace feedme2::screens {

// The grooming pose (B3) for the App::kFedMs the screen stays up; Idle then shows C4 through the
// hunger table, so the plan's "B3 then C4" is the Fed → Idle hand-over, not a timer here.
void buildFed(application::App& app) {
    lv_obj_t* scr = theme::freshScreen();
    const auto& fed = app.fedSummary();
    const auto* cat = app.roster().selected();
    const uint32_t rgb = cat != nullptr ? cat->colorRgb : theme::kText;
    createCat(scr, "B3", 88, rgb, 0, -34);
    const std::string line = "Logged " + amountText(app, fed.amountMg) + "\nfor " + fed.label;
    theme::label(scr, line.c_str(), theme::font18(), theme::kText, LV_ALIGN_CENTER, 0, 52, 200);
}

}  // namespace feedme2::screens
