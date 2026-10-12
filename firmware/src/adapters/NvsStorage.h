#pragma once

#include <Preferences.h>

#include <string>

#include "ports/IStorage.h"

namespace feedme2::adapters {

// ESP32 NVS through the Arduino Preferences wrapper, one namespace `feedme2`.
// Values are stored as blobs, not NVS strings: strings are capped at ~4000
// bytes and the cached house state JSON grows with the cat roster.
//
// NVS refuses a zero-length blob (putBytes returns 0), but callers do write
// empty values (e.g. an etag cleared after a 401). Each blob therefore carries
// the string's terminating NUL, so the stored length is always size()+1 and
// an empty value round-trips as a 1-byte blob.
//
// Every open is read-write, reads included: a read-only nvs_open on a
// namespace that has never been written fails with NOT_FOUND, and Preferences
// logs "nvs_open failed" for each one, so a fresh device would spam the
// console on every boot-time read until the first write. Read-write creates
// the namespace entry on the first open and is otherwise identical.
class NvsStorage final : public ports::IStorage {
public:
    bool read(const char* key, std::string& out) override {
        if (!prefs_.begin(kNamespace, /*readOnly=*/false)) return false;
        const size_t len = prefs_.isKey(key) ? prefs_.getBytesLength(key) : 0;
        if (len == 0) {
            prefs_.end();
            return false;
        }
        std::string buf(len, '\0');
        const size_t got = prefs_.getBytes(key, &buf[0], len);
        prefs_.end();
        if (got != len) return false;
        buf.resize(len - 1);  // drop the stored NUL
        out = std::move(buf);
        return true;
    }

    bool write(const char* key, const std::string& value) override {
        if (!prefs_.begin(kNamespace, /*readOnly=*/false)) return false;
        const size_t want = value.size() + 1;
        const size_t put = prefs_.putBytes(key, value.c_str(), want);
        prefs_.end();
        return put == want;
    }

    bool erase(const char* key) override {
        if (!prefs_.begin(kNamespace, /*readOnly=*/false)) return false;
        // Removing an absent key is not a failure for the caller (forget → erase token).
        const bool ok = !prefs_.isKey(key) || prefs_.remove(key);
        prefs_.end();
        return ok;
    }

private:
    // NVS namespace and key names are limited to 15 characters.
    static constexpr const char* kNamespace = "feedme2";
    Preferences prefs_;
};

}  // namespace feedme2::adapters
