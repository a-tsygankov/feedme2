#pragma once

namespace feedme2::ports {

class ILogSink {
public:
    virtual ~ILogSink() = default;
    // dataJsonOrNull: a JSON object string, or nullptr.
    virtual void write(const char* level, const char* msg, const char* dataJsonOrNull) = 0;
};

}  // namespace feedme2::ports
