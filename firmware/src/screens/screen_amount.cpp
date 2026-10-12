#include <string>

#include "screens/Builders.h"

namespace feedme2::screens {

// The amount in the house unit, number big and unit small; for "All cats" the knob picks a scale
// of each cat's default (spec §5.2) and the unit line says so.
void buildAmount(application::App& app) {
    lv_obj_t* scr = theme::freshScreen();
    const auto& flow = app.flow();

    const std::string title = flow.isAll() ? "All cats" : app.selectedCatName();
    theme::label(scr, title.c_str(), theme::font18(), theme::kText, LV_ALIGN_TOP_MID, 0, 28, 180);

    const std::string text = flow.amountText();
    const size_t cut = text.rfind(' ');
    const std::string number = cut == std::string::npos ? text : text.substr(0, cut);
    const std::string unit = flow.isAll() ? "x default" : (cut == std::string::npos ? "" : text.substr(cut + 1));
    theme::label(scr, number.c_str(), theme::font48(), theme::kText, LV_ALIGN_CENTER, 0, -16);
    theme::label(scr, unit.c_str(), theme::font14(), theme::kDim, LV_ALIGN_CENTER, 0, 30);

    theme::label(scr, "-", theme::font24(), theme::kDim, LV_ALIGN_CENTER, -92, -16);
    theme::label(scr, "+", theme::font24(), theme::kDim, LV_ALIGN_CENTER, 92, -16);
    theme::label(scr, "PRESS to log\nHOLD to cancel", theme::font12(), theme::kDim, LV_ALIGN_BOTTOM_MID, 0, -22);
}

}  // namespace feedme2::screens
