#include <cstdio>
#include <string>

#include "application/PairCoordinator.h"
#include "screens/Builders.h"

namespace feedme2::screens {

namespace {

constexpr const char* kPairUrlPrefix = "https://feedme2-webapp.pages.dev/settings?pair=";
constexpr int32_t kQrPx = 120;

const char* statusText(application::PairPhase phase) {
    using application::PairPhase;
    switch (phase) {
        case PairPhase::Idle: return "Press to start pairing";
        case PairPhase::Starting: return "Contacting the server...";
        case PairPhase::Pending: return "Enter this code in the app";
        case PairPhase::Confirmed: return "Paired!";
        case PairPhase::Expired: return "Expired - press to retry";
        case PairPhase::Failed: return "Failed - press to retry";
    }
    return "";
}

}  // namespace

// QR (the webapp's /settings?pair=<code> link) over the 6-digit code and a status line per phase.
// Press retries; the App decides whether a retry is allowed in the current phase.
void buildPair(application::App& app) {
    using application::PairPhase;
    lv_obj_t* scr = theme::freshScreen();
    const auto& view = app.pair().view();
    const bool showCode = view.pairCode.size() == 6 && (view.phase == PairPhase::Pending || view.phase == PairPhase::Confirmed);

    if (showCode) {
        lv_obj_t* qr = lv_qrcode_create(scr);
        lv_qrcode_set_size(qr, kQrPx);
        lv_qrcode_set_dark_color(qr, lv_color_black());
        lv_qrcode_set_light_color(qr, lv_color_white());
        const std::string url = std::string(kPairUrlPrefix) + view.pairCode;
        lv_qrcode_update(qr, url.c_str(), static_cast<uint32_t>(url.size()));
        // A white quiet zone: phone cameras lock on faster than against the dark theme directly.
        lv_obj_set_style_border_color(qr, lv_color_white(), 0);
        lv_obj_set_style_border_width(qr, 4, 0);
        lv_obj_align(qr, LV_ALIGN_TOP_MID, 0, 18);

        char code[12];
        const std::string& c = view.pairCode;
        std::snprintf(code, sizeof code, "%c%c%c %c%c%c", c[0], c[1], c[2], c[3], c[4], c[5]);
        theme::label(scr, code, theme::font24(), theme::kText, LV_ALIGN_TOP_MID, 0, 146);
    } else {
        theme::label(scr, "feedme2", theme::font24(), theme::kText, LV_ALIGN_CENTER, 0, -34);
    }

    const int32_t statusY = showCode ? 182 : 128;
    theme::label(scr, statusText(view.phase), theme::font14(), theme::kDim, LV_ALIGN_TOP_MID, 0, statusY, 180);
    if (view.phase == PairPhase::Failed && !view.error.empty()) {
        theme::label(scr, view.error.c_str(), theme::font12(), theme::kDim, LV_ALIGN_TOP_MID, 0, 160, 170);
    }
}

}  // namespace feedme2::screens
