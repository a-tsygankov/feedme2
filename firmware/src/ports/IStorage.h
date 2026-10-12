#pragma once
#include <string>

namespace feedme2::ports {

// Small persistent blobs (NVS). Keys in use: token, wifi, state (last state JSON), etag, name.
class IStorage {
public:
    virtual ~IStorage() = default;
    virtual bool read(const char* key, std::string& out) = 0;
    virtual bool write(const char* key, const std::string& value) = 0;
    virtual bool erase(const char* key) = 0;
};

}  // namespace feedme2::ports
