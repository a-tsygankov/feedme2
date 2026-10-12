#include "screens/Builders.h"
#include "screens/components/RoundList.h"

namespace feedme2::screens {

// Wi-Fi · Pair/Unpair · About · Sleep now, labels and selection from the App.
void buildSystem(application::App& app) {
    lv_obj_t* scr = theme::freshScreen();
    theme::label(scr, "System", theme::font14(), theme::kDim, LV_ALIGN_TOP_MID, 0, 22);
    const char* labels[application::App::kMenuCount];
    for (int i = 0; i < application::App::kMenuCount; ++i) labels[i] = app.menuLabel(i);
    createRoundList(scr, labels, application::App::kMenuCount, app.menuIndex());
    theme::label(scr, "hold to go back", theme::font12(), theme::kDim, LV_ALIGN_BOTTOM_MID, 0, -24);
}

}  // namespace feedme2::screens
