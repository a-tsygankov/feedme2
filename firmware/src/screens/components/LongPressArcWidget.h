#pragma once
// The perimeter arc that charges while the knob or the glass is held (spec §5.2, 600 ms). It lives
// on the top layer so it survives screen rebuilds, stays hidden until the hold starts and takes its
// progress from domain::LongPressArc every frame. The LongPress event itself comes from the input
// adapter; this is only the picture of it.
#include <lvgl.h>

#include "domain/LongPressArc.h"
#include "screens/Theme.h"

namespace feedme2::screens {

class LongPressArcWidget {
public:
    void create() {
        arc_ = lv_arc_create(lv_layer_top());
        lv_obj_set_size(arc_, 236, 236);
        lv_obj_center(arc_);
        lv_arc_set_rotation(arc_, 270);
        lv_arc_set_bg_angles(arc_, 0, 360);
        lv_arc_set_range(arc_, 0, 100);
        lv_arc_set_value(arc_, 0);
        lv_obj_remove_style(arc_, nullptr, LV_PART_KNOB);
        lv_obj_remove_flag(arc_, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_style_arc_width(arc_, 6, LV_PART_MAIN);
        lv_obj_set_style_arc_width(arc_, 6, LV_PART_INDICATOR);
        lv_obj_set_style_arc_opa(arc_, LV_OPA_TRANSP, LV_PART_MAIN);  // track hidden: only the charge shows
        lv_obj_set_style_arc_color(arc_, lv_color_hex(theme::kText), LV_PART_INDICATOR);
        lv_obj_add_flag(arc_, LV_OBJ_FLAG_HIDDEN);
    }

    void update(const domain::LongPressArc& model) {
        if (arc_ == nullptr) return;
        if (!model.charging()) {
            if (!lv_obj_has_flag(arc_, LV_OBJ_FLAG_HIDDEN)) lv_obj_add_flag(arc_, LV_OBJ_FLAG_HIDDEN);
            lv_arc_set_value(arc_, 0);
            return;
        }
        if (lv_obj_has_flag(arc_, LV_OBJ_FLAG_HIDDEN)) lv_obj_remove_flag(arc_, LV_OBJ_FLAG_HIDDEN);
        lv_arc_set_value(arc_, model.percent());
    }

private:
    lv_obj_t* arc_ = nullptr;
};

}  // namespace feedme2::screens
