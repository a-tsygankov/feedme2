#pragma once
// A 4-row vertical menu for the round display (System): montserrat 18, the selected row on a
// highlight pill. Selection belongs to the App (menuIndex); the list only draws it.
#include <lvgl.h>

#include "screens/Theme.h"

namespace feedme2::screens {

constexpr int kRoundListRows = 4;
constexpr int32_t kRoundListPitch = 36;

inline void createRoundList(lv_obj_t* parent, const char* const* labels, int count, int selected) {
    const int rows = count < kRoundListRows ? count : kRoundListRows;
    const int32_t top = -((rows - 1) * kRoundListPitch) / 2;
    for (int i = 0; i < rows; ++i) {
        const int32_t y = top + i * kRoundListPitch;
        if (i == selected) {
            lv_obj_t* pill = lv_obj_create(parent);
            lv_obj_set_size(pill, 170, 30);
            lv_obj_set_style_radius(pill, 15, 0);
            lv_obj_set_style_bg_color(pill, lv_color_hex(theme::kHighlight), 0);
            lv_obj_set_style_bg_opa(pill, LV_OPA_COVER, 0);
            lv_obj_set_style_border_width(pill, 0, 0);
            lv_obj_remove_flag(pill, LV_OBJ_FLAG_SCROLLABLE);
            lv_obj_remove_flag(pill, LV_OBJ_FLAG_CLICKABLE);
            lv_obj_align(pill, LV_ALIGN_CENTER, 0, y);
        }
        theme::label(parent, labels[i], theme::font18(), i == selected ? theme::kText : theme::kDim, LV_ALIGN_CENTER, 0, y);
    }
}

}  // namespace feedme2::screens
