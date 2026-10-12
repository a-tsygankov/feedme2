#pragma once

#include "ports/IStorage.h"

namespace feedme2::adapters {

// First-boot Wi-Fi setup (not compiled under -DSIMULATOR=1), ported from
// howler: an open SoftAP `feedme2-XXXX` (last two MAC bytes), a DNS catch-all
// on 53 so a phone's captive-portal probe opens the sign-in sheet, and a one
// page form on 80 (a <select> of the networks scanned before the AP came up,
// a free-text SSID for hidden networks, a password). POST /save stores the
// credentials as WifiStation's NVS blob and the device restarts into station
// mode; there is no in-place switch back, hence [[noreturn]].
class WifiCaptivePortal {
public:
    [[noreturn]] void runAndReboot(ports::IStorage& storage);
};

}  // namespace feedme2::adapters
