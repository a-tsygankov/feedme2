#pragma once
// Loads a cross-tier vector file from the repo's fixtures/ directory.
// Native tests run with cwd = firmware/, so the path is ../fixtures/.
#include <fstream>
#include <sstream>
#include <string>
#include <ArduinoJson.h>

inline std::string readFixture(const char* name) {
    std::ifstream in(std::string("../fixtures/") + name);
    std::stringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

inline JsonDocument loadFixture(const char* name) {
    JsonDocument doc;
    const auto err = deserializeJson(doc, readFixture(name));
    if (err) { doc.clear(); doc["__error"] = err.c_str(); }
    return doc;
}
