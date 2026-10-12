#if !SIMULATOR

#include "adapters/WifiCaptivePortal.h"

#include <Arduino.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>
#include <soc/rtc_cntl_reg.h>
#include <soc/soc.h>

#include <string>
#include <vector>

#include "adapters/WifiStation.h"

namespace feedme2::adapters {

namespace {

constexpr uint16_t kDnsPort = 53;
constexpr uint16_t kHttpPort = 80;

const char kFormHtml[] PROGMEM = R"HTML(<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>feedme2 setup</title>
<style>
body{font:16px system-ui;margin:0;padding:24px;background:#1a1226;color:#f6f1e6;}
h1{color:#f6f1e6;font-weight:400;font-size:22px;margin:0 0 18px;}
label{display:block;margin:14px 0 4px;font-size:13px;color:#9c97a4;text-transform:uppercase;letter-spacing:.08em;}
input,select{width:100%;padding:12px;border:1px solid #3a2f4a;background:#120c1a;color:#f6f1e6;border-radius:6px;font-size:16px;box-sizing:border-box;}
button{margin-top:24px;width:100%;padding:14px;border:0;background:#7c4dff;color:#f6f1e6;font-size:16px;font-weight:600;border-radius:6px;cursor:pointer;}
.hint{font-size:12px;color:#9c97a4;margin-top:14px;padding:12px;background:#120c1a;border:1px solid #3a2f4a;border-radius:6px;line-height:1.4;}
.sub{font-size:12px;color:#9c97a4;margin-top:4px;}
</style></head><body>
<h1>feedme2 setup</h1>
<form method="POST" action="/save">
<label>Wi-Fi network</label>
<select name="ssid_pick">
<option value="">-- pick a visible network --</option>
{SSID_OPTIONS}
</select>
<label>Or type SSID</label>
<input type="text" name="ssid_text" placeholder="hidden / not in the list" autocapitalize="none" autocorrect="off">
<div class="sub">The typed name wins over the list when both are filled.</div>
<label>Password</label>
<input type="password" name="pass" autocomplete="off">
<div class="hint">After Save the device restarts and shows a 6-digit pairing code.
Open the feedme2 web app and enter the code under Devices.</div>
<button type="submit">Save and connect</button>
</form>
</body></html>)HTML";

const char kDoneHtml[] PROGMEM = R"HTML(<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saved</title>
<style>body{font:16px system-ui;margin:0;padding:48px;background:#1a1226;color:#f6f1e6;text-align:center;}
h1{font-weight:400;}</style>
</head><body>
<h1>Saved</h1>
<p>The device is restarting. You can leave this Wi-Fi now.</p>
</body></html>)HTML";

// An SSID is arbitrary bytes chosen by a stranger's router; unescaped it could break out of the
// <option> and inject markup into the setup page.
String htmlEscape(const String& in) {
    String out;
    out.reserve(in.length() + 8);
    for (size_t i = 0; i < in.length(); ++i) {
        const char c = in[i];
        switch (c) {
            case '&': out += "&amp;"; break;
            case '<': out += "&lt;"; break;
            case '>': out += "&gt;"; break;
            case '"': out += "&quot;"; break;
            case '\'': out += "&#39;"; break;
            default: out += c; break;
        }
    }
    return out;
}

String buildSsidOptions(const std::vector<String>& ssids) {
    if (ssids.empty()) return "<option value=\"\" disabled>(no networks found)</option>";
    String options;
    for (const auto& s : ssids) {
        const String safe = htmlEscape(s);
        options += "<option value=\"" + safe + "\">" + safe + "</option>";
    }
    return options;
}

}  // namespace

void WifiCaptivePortal::runAndReboot(ports::IStorage& storage) {
    // The SoftAP's TX bursts dip the CrowPanel's 3.3 V rail enough to trip the brownout detector
    // on some boards (seen on feedme/howler: a reset loop the moment the AP came up). The portal
    // is a short, person-attended session, so the detector is muted for its duration only; the
    // restart below re-enables it.
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

    uint8_t mac[6];
    WiFi.macAddress(mac);
    char apName[32];
    snprintf(apName, sizeof(apName), "feedme2-%02x%02x", mac[4], mac[5]);
    Serial.printf("[feedme2] portal start ap=%s\n", apName);

    // Scan before the AP comes up: the radio must be in a clean STA state or the scan reports
    // zero networks even with several in range (the "(no networks found)" symptom in howler).
    WiFi.mode(WIFI_STA);
    WiFi.disconnect(/*wifioff=*/true, /*eraseap=*/true);
    delay(150);
    std::vector<String> ssids;
    const int n = WiFi.scanNetworks(/*async=*/false, /*show_hidden=*/true);
    for (int i = 0; i < n; ++i) {
        const String s = WiFi.SSID(i);
        if (s.length() == 0) continue;  // a hidden network has no name to list; the text field covers it
        ssids.push_back(s);
    }
    WiFi.scanDelete();
    Serial.printf("[feedme2] portal scanned=%d named=%u\n", n, static_cast<unsigned>(ssids.size()));

    WiFi.mode(WIFI_AP);
    WiFi.softAP(apName);
    delay(100);
    const IPAddress ip = WiFi.softAPIP();
    Serial.printf("[feedme2] portal up ip=%s\n", ip.toString().c_str());

    DNSServer dns;
    dns.start(kDnsPort, "*", ip);

    WebServer http(kHttpPort);
    bool saved = false;
    String pendingSsid;
    String pendingPass;

    const auto serveForm = [&]() {
        String body = kFormHtml;
        body.replace("{SSID_OPTIONS}", buildSsidOptions(ssids));
        http.send(200, "text/html", body);
    };
    http.on("/", HTTP_GET, serveForm);
    // Any other path, including the OS probe URLs, gets the form: that is what makes the phone
    // decide the network needs a sign-in and open it.
    http.onNotFound(serveForm);
    http.on("/save", HTTP_POST, [&]() {
        // Typed name wins so a hidden SSID works even when a stale pick is still selected. Trimmed
        // because phone keyboards append a space after an autocomplete.
        String text = http.arg("ssid_text");
        text.trim();
        String pick = http.arg("ssid_pick");
        pick.trim();
        pendingSsid = text.length() > 0 ? text : pick;
        pendingPass = http.arg("pass");
        if (pendingSsid.isEmpty()) {
            http.send(400, "text/plain", "ssid required (pick or type)");
            return;
        }
        http.send(200, "text/html", String(kDoneHtml));
        saved = true;
    });
    http.begin();

    while (!saved) {
        dns.processNextRequest();
        http.handleClient();
        delay(2);
    }

    const std::string blob = WifiStation::encodeCredentials(std::string(pendingSsid.c_str()), std::string(pendingPass.c_str()));
    if (storage.write(WifiStation::kWifiKey, blob)) {
        // The SSID is typed by whoever is on the portal; one containing a newline would forge a
        // second `[feedme2] …` serial line, so only its length is logged, never the text.
        Serial.printf("[feedme2] portal saved ssid_len=%u\n", static_cast<unsigned>(pendingSsid.length()));
    } else {
        Serial.println("[feedme2] portal save failed");
    }
    // Let the "Saved" page reach the phone before the AP disappears.
    delay(500);
    http.stop();
    dns.stop();
    WiFi.softAPdisconnect(true);
    ESP.restart();
    for (;;) delay(1000);  // ESP.restart() is not declared noreturn
}

}  // namespace feedme2::adapters

#endif  // !SIMULATOR
