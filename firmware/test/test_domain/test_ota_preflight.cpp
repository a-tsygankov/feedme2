#include <unity.h>
#include "domain/OtaPreflight.h"

using namespace feedme2::domain::ota;

namespace {
struct Verifier final : SignatureVerifier {
    bool trusted = true;
    bool valid = true;
    mutable unsigned checks = 0;
    bool trustedKey(const std::string& id) const override { return trusted && id == "release-key-1"; }
    bool verifyEd25519(const std::string&, const std::string& bytes,
                       const std::string&) const override {
        ++checks;
        return valid && bytes.find("feedme2-ota-manifest-v1\nmodel=xiao-esp32s3-sense-scale\n") == 0;
    }
};
const std::string digest(64, 'a');
const std::string signature = std::string(85, 'A') + "Q==";
Manifest good() {
    return {kXiaoModel, "0.1.42", 512u * 1024u, digest, "release-key-1", signature};
}
Device device() { return {kXiaoModel, "0.1.41", kMaxXiaoImageBytes}; }
}

void test_ota_preflight_accepts_only_independently_verified_manifest() {
    Verifier verifier;
    const auto m = good();
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::Allowed),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    TEST_ASSERT_EQUAL_UINT(1, verifier.checks);
    TEST_ASSERT_EQUAL_STRING(
        "feedme2-ota-manifest-v1\nmodel=xiao-esp32s3-sense-scale\nversion=0.1.42\n"
        "imageBytes=524288\nsha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"
        "keyId=release-key-1\n", canonicalBytes(m).c_str());
}

void test_ota_preflight_rejects_model_downgrade_and_bad_versions() {
    Verifier verifier;
    auto m = good();
    m.model = "crowpanel-1.28";
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::WrongModel),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    m = good();
    m.version = "0.1.41";
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::NotNewer),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    m.version = "0.1.40";
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::NotNewer),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    m.version = "0.1.42-rc";
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::InvalidVersion),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    m.version = "4294967295.1.1";
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::InvalidVersion),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    m.version = "0.01.42";
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::InvalidVersion),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    TEST_ASSERT_EQUAL_UINT(0, verifier.checks);
}

void test_ota_preflight_rejects_slot_size_digest_and_signature() {
    Verifier verifier;
    auto m = good();
    m.imageBytes = kMaxXiaoImageBytes + 1;
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::InvalidImageSize),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    m = good();
    auto d = device();
    d.inactiveSlotBytes = 100000;
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::InvalidImageSize),
        static_cast<int>(preflight(d, m, digest, verifier)));
    m = good();
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::InvalidDigest),
        static_cast<int>(preflight(device(), m, std::string(64, 'b'), verifier)));
    m = good();
    m.sha256Hex[0] = 'Z';
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::InvalidManifest),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    m = good();
    m.signatureBase64 = "not-a-signature";
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::InvalidManifest),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    m = good();
    m.keyId = "release-key-1\nversion=evil";
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::InvalidManifest),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    m = good();
    verifier.trusted = false;
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::UntrustedKey),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    verifier.trusted = true;
    verifier.valid = false;
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::BadSignature),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    TEST_ASSERT_EQUAL_UINT(1, verifier.checks);
}

void test_ota_preflight_rejects_unprovisioned_verifier_and_invalid_base64_tail() {
    Verifier verifier;
    verifier.trusted = false;
    auto m = good();
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::UntrustedKey),
        static_cast<int>(preflight(device(), m, digest, verifier)));
    m.signatureBase64 = std::string(86, 'A') + "=="; // invalid tail pad bits? A is valid; length is 88
    TEST_ASSERT_TRUE(validEd25519Base64(m.signatureBase64));
    m.signatureBase64[85] = 'B';
    TEST_ASSERT_FALSE(validEd25519Base64(m.signatureBase64));
    TEST_ASSERT_EQUAL_INT(static_cast<int>(Verdict::InvalidManifest),
        static_cast<int>(preflight(device(), m, digest, verifier)));
}
