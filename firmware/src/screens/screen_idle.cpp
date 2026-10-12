#include <string>

#include "domain/FeedFlow.h"
#include "screens/Builders.h"
#include "screens/components/CatImage.h"
#include "screens/components/HungerRing.h"

namespace feedme2::screens {

namespace {

constexpr int32_t kCatDy = -4;
constexpr int32_t kFedLineDy = 74;
constexpr int32_t kAmountBottom = -24;

// "fed 2 h ago" / "never fed" / the unsynced placeholder (Review Focus 4): a cat the device has
// never seen fed cannot be aged without a wall clock, and a cached lastFedAt is aged from the
// snapshot's `now` plus uptime (App::wallNowMs), which is close enough for a label.
std::string fedLine(const application::App& app, const domain::CatState& cat) {
    if (cat.hasLastFed) return "fed " + theme::agoText(app.wallNowMs() - cat.lastFedAtMs);
    return app.clockSynced() ? "never fed" : "clock not synced";
}

// The ring for "All cats" follows the hungriest cat, the same cat App::selectedLevel() reports.
const domain::CatState* hungriest(const application::App& app, domain::HungerState& out) {
    const domain::CatState* worst = nullptr;
    for (const auto& c : app.roster().cats()) {
        const domain::HungerState h = app.hungerOf(c);
        if (worst == nullptr || h.level > out.level || (h.level == out.level && h.ratio > out.ratio)) {
            worst = &c;
            out = h;
        }
    }
    return worst;
}

void buildAll(application::App& app, lv_obj_t* scr, lv_obj_t* ring) {
    const auto& cats = app.roster().cats();
    domain::HungerState worstState{};
    const domain::CatState* worst = hungriest(app, worstState);
    setHunger(ring, worstState);

    // Up to three 88 px avatars side by side, each in its own pose and colour; a fourth cat does
    // not fit inside the ring and is counted in the label instead.
    const int shown = cats.size() < 3 ? static_cast<int>(cats.size()) : 3;
    const int32_t pitch = shown == 2 ? 80 : 64;
    const int32_t first = -((shown - 1) * pitch) / 2;
    for (int i = 0; i < shown; ++i) {
        const auto& c = cats[static_cast<size_t>(i)];
        const std::string pose = poseForLevel(app.hungerOf(c).level, c.avatarPose);
        createCat(scr, pose.c_str(), 88, c.colorRgb, first + i * pitch, kCatDy);
    }
    if (worst != nullptr) {
        const std::string line = worst->name + " " + fedLine(app, *worst);
        theme::label(scr, line.c_str(), theme::font14(), theme::kDim, LV_ALIGN_CENTER, 0, kFedLineDy, 200);
    }
    theme::label(scr, "each cat's default", theme::font14(), theme::kDim, LV_ALIGN_BOTTOM_MID, 0, kAmountBottom);
}

void buildOne(application::App& app, lv_obj_t* scr, lv_obj_t* ring, const domain::CatState& cat) {
    const domain::HungerState h = app.hungerOf(cat);
    setHunger(ring, h);
    const std::string pose = poseForLevel(h.level, cat.avatarPose);
    createCat(scr, pose.c_str(), 130, cat.colorRgb, 0, kCatDy);
    theme::label(scr, fedLine(app, cat).c_str(), theme::font14(), theme::kDim, LV_ALIGN_CENTER, 0, kFedLineDy, 200);
    const int32_t mg = cat.hasDefault && cat.defaultAmountMg > 0 ? cat.defaultAmountMg : domain::kFallbackMg;
    theme::label(scr, amountText(app, mg).c_str(), theme::font14(), theme::kDim, LV_ALIGN_BOTTOM_MID, 0, kAmountBottom);
}

}  // namespace

void buildIdle(application::App& app) {
    lv_obj_t* scr = theme::freshScreen();
    const auto& roster = app.roster();
    if (!app.hasState() || roster.count() == 0) {
        theme::label(scr, "No cats yet", theme::font18(), theme::kText, LV_ALIGN_CENTER, 0, -12);
        theme::label(scr, "add one in the app", theme::font14(), theme::kDim, LV_ALIGN_CENTER, 0, 16);
        return;
    }
    lv_obj_t* ring = createRing(scr);
    const std::string title = roster.isAllSelected() ? "All cats" : app.selectedCatName();
    theme::label(scr, title.c_str(), theme::font18(), theme::kText, LV_ALIGN_TOP_MID, 0, 28, 180);
    if (const auto* cat = roster.selected()) buildOne(app, scr, ring, *cat);
    else buildAll(app, scr, ring);
}

}  // namespace feedme2::screens
