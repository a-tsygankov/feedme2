#pragma once
// The 236 px hunger ring of the Idle screen: fill = 1 - min(ratio, 1), coloured by the level.
//
// Starving ("red, pulsing", spec §1.6) is a red comet running round the track, not a style
// pulse: changing an arc's opacity or colour invalidates its whole 236 px box, which contains the
// cat image, and with LV_CACHE_DEF_SIZE 0 every such frame would re-inflate the PNG. Moving an
// arc's angles invalidates only the two small sectors that changed (lv_arc's inv_arc_area), which
// never reach the 130 px cat in the middle.
#include <lvgl.h>

#include <algorithm>
#include <cstdint>

#include "domain/Hunger.h"
#include "screens/Theme.h"

namespace feedme2::screens {

constexpr int32_t kRingPx = 236;
constexpr int32_t kRingWidth = 8;
constexpr int32_t kCometDeg = 40;
constexpr uint32_t kCometPeriodMs = 1600;

inline lv_obj_t* createRing(lv_obj_t* parent) {
    lv_obj_t* arc = lv_arc_create(parent);
    lv_obj_set_size(arc, kRingPx, kRingPx);
    lv_obj_center(arc);
    lv_arc_set_rotation(arc, 270);
    lv_arc_set_bg_angles(arc, 0, 360);
    lv_arc_set_range(arc, 0, 1000);
    lv_arc_set_value(arc, 0);
    lv_obj_remove_style(arc, nullptr, LV_PART_KNOB);
    lv_obj_remove_flag(arc, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(arc, kRingWidth, LV_PART_MAIN);
    lv_obj_set_style_arc_width(arc, kRingWidth, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(arc, lv_color_hex(theme::kTrack), LV_PART_MAIN);
    lv_obj_set_style_arc_rounded(arc, false, LV_PART_MAIN);
    lv_obj_set_style_arc_rounded(arc, false, LV_PART_INDICATOR);
    return arc;
}

inline void cometStep(void* var, int32_t deg) {
    lv_arc_set_angles(static_cast<lv_obj_t*>(var), deg, deg + kCometDeg);
}

// Called once per build; the ring is deleted with the screen, which also stops its animation.
inline void setHunger(lv_obj_t* arc, const domain::HungerState& h) {
    lv_obj_set_style_arc_color(arc, lv_color_hex(theme::levelRgb(h.level)), LV_PART_INDICATOR);
    if (h.level == domain::HungerLevel::Starving) {
        lv_anim_t a;
        lv_anim_init(&a);
        lv_anim_set_var(&a, arc);
        lv_anim_set_exec_cb(&a, cometStep);
        lv_anim_set_values(&a, 0, 360);
        lv_anim_set_duration(&a, kCometPeriodMs);
        lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
        lv_anim_start(&a);
        return;
    }
    const double fill = 1.0 - std::min(h.ratio, 1.0);
    lv_arc_set_value(arc, static_cast<int32_t>(fill * 1000.0 + 0.5));
}

}  // namespace feedme2::screens
