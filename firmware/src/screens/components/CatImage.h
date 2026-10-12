#pragma once
// A cat silhouette tinted with the cat's colour. The PNG is decoded by lodepng on every draw
// (LV_CACHE_DEF_SIZE is 0), so nothing in the screens may animate over the image area.
#include <lvgl.h>

#include <cstdint>
#include <string>

#include "assets/cats/CatAssets.h"
#include "domain/Hunger.h"

namespace feedme2::screens {

// Spec §1.6, the same table as the webapp's poseForLevel.
inline std::string poseForLevel(domain::HungerLevel level, const std::string& avatarPose) {
    switch (level) {
        case domain::HungerLevel::Fed: return "C4";
        case domain::HungerLevel::Content: return avatarPose.empty() ? "C2" : avatarPose;
        case domain::HungerLevel::Peckish: return "A2";
        case domain::HungerLevel::Hungry: return "B2";
        case domain::HungerLevel::VeryHungry: return "B4";
        case domain::HungerLevel::Starving: return "C3";
    }
    return "C2";
}

// size: 130 (Idle) or 88 (Fed, All cats). dx/dy are offsets from the screen centre.
inline lv_obj_t* createCat(lv_obj_t* parent, const char* slug, uint8_t size, uint32_t rgb, int32_t dx, int32_t dy) {
    lv_obj_t* img = lv_image_create(parent);
    lv_image_set_src(img, catImage(slug, size));
    lv_obj_set_style_image_recolor(img, lv_color_hex(rgb), 0);
    lv_obj_set_style_image_recolor_opa(img, LV_OPA_COVER, 0);
    lv_obj_remove_flag(img, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_align(img, LV_ALIGN_CENTER, dx, dy);
    return img;
}

}  // namespace feedme2::screens
