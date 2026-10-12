#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

namespace feedme2::ports {

class IRandom {
public:
    virtual ~IRandom() = default;
    // 36-char lowercase v4 UUID (client-generated primary keys).
    virtual std::string uuid() = 0;
    virtual uint32_t next() = 0;
    // `bytes` random bytes as lowercase hex (2 * bytes chars). CSPRNG on the device
    // (esp_random); used for the pairing pollSecret.
    virtual std::string hex(size_t bytes) = 0;
};

}  // namespace feedme2::ports
