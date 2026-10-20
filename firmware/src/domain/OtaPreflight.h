#pragma once

// Pure, host-tested policy for a *future* XIAO OTA installer.
// It does not download, authenticate, hash, flash, reboot or install an image.
// Callers must supply an independently computed SHA-256 digest and a real
// signature verifier bound to a provisioned, trusted release key.
#include <array>
#include <cstdint>
#include <string>

namespace feedme2::domain::ota {

constexpr const char* kXiaoModel = "xiao-esp32s3-sense-scale";
constexpr uint32_t kMaxXiaoImageBytes = 0x300000u; // app0/app1 slot size in xiao_8mb.csv
constexpr uint32_t kMinImageBytes = 64u * 1024u;

struct Manifest {
    std::string model;
    std::string version;
    uint32_t imageBytes = 0;
    std::string sha256Hex;
    std::string keyId;
    std::string signatureBase64; // Ed25519: 64 bytes => 88 base64 chars
};

struct Device {
    std::string model;
    std::string runningVersion;
    uint32_t inactiveSlotBytes = 0;
};

enum class Verdict {
    Allowed,
    InvalidManifest,
    WrongModel,
    InvalidVersion,
    NotNewer,
    InvalidImageSize,
    InvalidDigest,
    UntrustedKey,
    BadSignature
};

// Must perform real signature verification against an independently
// provisioned key. The API intentionally has no permissive default.
class SignatureVerifier {
public:
    virtual ~SignatureVerifier() = default;
    virtual bool trustedKey(const std::string& keyId) const = 0;
    virtual bool verifyEd25519(const std::string& keyId,
                               const std::string& signedBytes,
                               const std::string& signatureBase64) const = 0;
};

// Stable, unambiguous bytes signed by the release operator. Never sign JSON
// serialization (key order/whitespace differs between implementations).
inline std::string canonicalBytes(const Manifest& m) {
    return std::string("feedme2-ota-manifest-v1\n") +
        "model=" + m.model + "\n" +
        "version=" + m.version + "\n" +
        "imageBytes=" + std::to_string(m.imageBytes) + "\n" +
        "sha256=" + m.sha256Hex + "\n" +
        "keyId=" + m.keyId + "\n";
}

inline bool versionNumbers(const std::string& s, std::array<uint32_t, 3>& out) {
    if (s.size() < 5 || s.size() > 32) return false;
    size_t i = 0;
    for (size_t n = 0; n < 3; ++n) {
        if (i >= s.size()) return false;
        uint32_t value = 0;
        const size_t begin = i;
        while (i < s.size() && s[i] >= '0' && s[i] <= '9') {
            if (value > 99999u) return false; // components max 999999
            value = value * 10 + static_cast<uint32_t>(s[i++] - '0');
        }
        if (begin == i || (i - begin > 1 && s[begin] == '0')) return false;
        out[n] = value;
        if (n < 2) {
            if (i >= s.size() || s[i] != '.') return false;
            ++i;
        }
    }
    return i == s.size();
}

inline bool lowerHexSha256(const std::string& s) {
    if (s.size() != 64) return false;
    for (char c : s)
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}

inline bool validEd25519Base64(const std::string& s) {
    if (s.size() != 88 || s[86] != '=' || s[87] != '=') return false;
    for (size_t i = 0; i < 86; ++i) {
        const char c = s[i];
        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
              (c >= '0' && c <= '9') || c == '+' || c == '/')) return false;
    }
    // Last base64 sextet for 64-byte Ed25519 signature has four zero pad bits.
    const char tail = s[85];
    const char* alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (int i = 0; i < 64; ++i)
        if (alphabet[i] == tail) return (i & 15) == 0;
    return false;
}

inline bool safeIdentifier(const std::string& s) {
    if (s.empty() || s.size() > 32) return false;
    for (char c : s)
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return false;
    return true;
}

// digestHex MUST be calculated from the complete received image using SHA-256,
// not copied from the manifest. This is a policy gate, not a hashing routine.
inline Verdict preflight(const Device& device, const Manifest& manifest,
                         const std::string& digestHex,
                         const SignatureVerifier& verifier) {
    if (manifest.model != kXiaoModel || device.model != kXiaoModel)
        return Verdict::WrongModel;
    std::array<uint32_t, 3> current{}, next{};
    if (!versionNumbers(device.runningVersion, current) ||
        !versionNumbers(manifest.version, next)) return Verdict::InvalidVersion;
    if (!(next > current)) return Verdict::NotNewer;
    if (manifest.imageBytes < kMinImageBytes ||
        manifest.imageBytes > kMaxXiaoImageBytes ||
        manifest.imageBytes > device.inactiveSlotBytes) return Verdict::InvalidImageSize;
    if (!lowerHexSha256(manifest.sha256Hex) || !lowerHexSha256(digestHex))
        return Verdict::InvalidManifest;
    // Constant-time comparison of fixed-length lowercase ASCII SHA-256 hex.
    unsigned mismatch = 0;
    for (size_t i = 0; i < 64; ++i)
        mismatch |= static_cast<unsigned>(manifest.sha256Hex[i] ^ digestHex[i]);
    if (mismatch) return Verdict::InvalidDigest;
    if (!safeIdentifier(manifest.keyId) || !validEd25519Base64(manifest.signatureBase64))
        return Verdict::InvalidManifest;
    if (!verifier.trustedKey(manifest.keyId)) return Verdict::UntrustedKey;
    if (!verifier.verifyEd25519(manifest.keyId, canonicalBytes(manifest),
                                manifest.signatureBase64)) return Verdict::BadSignature;
    return Verdict::Allowed;
}

} // namespace feedme2::domain::ota
