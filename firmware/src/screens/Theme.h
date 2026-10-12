#pragma once
// Colours, fonts and the few label helpers every screen shares (plan Task 14). The screens are
// pure renderers of application::App: nothing here prints, and nothing here reads input.
#include <lvgl.h>

#include <cstdint>
#include <cstdio>
#include <string>

#include "domain/Hunger.h"

namespace feedme2::screens::theme {

constexpr uint32_t kBg = 0x1a1226;
constexpr uint32_t kText = 0xf6f1e6;
constexpr uint32_t kDim = 0x9c97a4;
constexpr uint32_t kTrack = 0x2d2340;      // the empty part of a ring
constexpr uint32_t kHighlight = 0x3a2f4a;  // selected menu row
constexpr uint32_t kGood = 0x4CAF50;
constexpr uint32_t kWarn = 0xFFB300;
constexpr uint32_t kDanger = 0xE53935;

inline const lv_font_t* font12() { return &lv_font_montserrat_12; }
inline const lv_font_t* font14() { return &lv_font_montserrat_14; }
inline const lv_font_t* font18() { return &lv_font_montserrat_18; }
inline const lv_font_t* font24() { return &lv_font_montserrat_24; }
inline const lv_font_t* font48() { return &lv_font_montserrat_48; }

inline uint32_t levelRgb(domain::HungerLevel level) {
    switch (domain::levelColor(level)) {
        case domain::LevelColor::Good: return kGood;
        case domain::LevelColor::Warn: return kWarn;
        case domain::LevelColor::Danger: return kDanger;
    }
    return kDanger;
}

// A centred label. Width 0 keeps LVGL's content sizing; otherwise the text wraps inside `width`.
inline lv_obj_t* label(lv_obj_t* parent, const char* text, const lv_font_t* font, uint32_t rgb, lv_align_t align,
                       int32_t dx, int32_t dy, int32_t width = 0) {
    lv_obj_t* l = lv_label_create(parent);
    lv_label_set_text(l, text);
    lv_obj_set_style_text_font(l, font, 0);
    lv_obj_set_style_text_color(l, lv_color_hex(rgb), 0);
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    if (width > 0) {
        lv_obj_set_width(l, width);
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
    }
    lv_obj_align(l, align, dx, dy);
    return l;
}

// Empties the active screen, paints the theme background and removes the scrollbars a round
// display would otherwise show when a label sits near the rim.
inline lv_obj_t* freshScreen() {
    lv_obj_t* scr = lv_screen_active();
    lv_obj_clean(scr);
    lv_obj_set_style_bg_color(scr, lv_color_hex(kBg), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);
    lv_obj_remove_flag(scr, LV_OBJ_FLAG_SCROLLABLE);
    return scr;
}

// "just now", "35 min ago", "2 h ago", "3 d ago". A negative delta (a stamp from the future,
// clock skew) reads as just now, the same clamp domain::hungerState applies.
inline std::string agoText(int64_t deltaMs) {
    if (deltaMs < 60'000) return "just now";
    const int64_t minutes = deltaMs / 60'000;
    char buf[24];
    if (minutes < 60) std::snprintf(buf, sizeof buf, "%ld min ago", static_cast<long>(minutes));
    else if (minutes < 48 * 60) std::snprintf(buf, sizeof buf, "%ld h ago", static_cast<long>(minutes / 60));
    else std::snprintf(buf, sizeof buf, "%ld d ago", static_cast<long>(minutes / (24 * 60)));
    return buf;
}

// Epoch-ms before 2020 is not a wall-clock stamp: the device logged it before its first server
// `now` (monotonic ms) and the server will clamp it (Review Focus 4). Mirrors FakeNetwork.
constexpr int64_t kEpochSaneMs = 1577836800000;

}  // namespace feedme2::screens::theme
