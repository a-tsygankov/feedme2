# XIAO OTA stage 2: signed-manifest preflight contract

Stage 1 (PR #18) only checks for newer versions. Stage 2 adds **pure, native-tested policy** in `firmware/src/domain/OtaPreflight.h` for a future OTA installer. **No production signature-verification adapter, signing key, manifest delivery, image download, flash write, automatic update, or rollback is enabled.** The running XIAO firmware still only checks advisory metadata.

## Manifest v1 (future signed release)

A future release manifest must include `model`, `version`, `imageBytes`, `sha256Hex`, `keyId`, and `signatureBase64`. Only `xiao-esp32s3-sense-scale` is eligible. Versions are strict numeric `major.minor.patch` with each component 0–999999 and no leading zeros; only strictly newer versions pass. Images must be between 64 KiB and the **smaller** of the 3 MiB XIAO partition slot and the runtime-reported inactive slot capacity. Hashes are 64 lowercase SHA-256 hex characters. Signatures are canonical 64-byte Ed25519 signatures in padded base64. Key IDs use lowercase ASCII letters, digits and hyphens.

The signature covers these exact UTF-8 bytes (LF line endings, including final LF), where values are substituted verbatim after validation:

```text
feedme2-ota-manifest-v1
model=xiao-esp32s3-sense-scale
version=0.1.42
imageBytes=524288
sha256=<64 lowercase SHA-256 hex chars>
keyId=release-key-1
```

The signature does not cover JSON whitespace or property order. The verifier must use a **trusted, independently provisioned public key** for `keyId`. Never fetch signing keys from the same manifest or server response. The pure policy accepts a `SignatureVerifier` interface: native unit tests inject a fake verifier **only to test control flow**, not Ed25519 cryptography. Production must supply a real implementation, validate against known signature vectors, and fail closed if no trusted key is provisioned. The `digestHex` argument must come from SHA-256 over the **complete received binary**, not from the manifest; policy compares fixed-length digests in constant time.

## Installer gates still required

1. Provision and pin release verification public keys, with key rotation and revocation rules; test actual Ed25519 signature verification on ESP32 and native hosts.
2. Publish immutable, authenticated manifests and binaries with verified image size and hash, streaming with bounded memory and redirect protections.
3. Use ESP-IDF OTA APIs to write only the inactive partition, validate image header, flash integrity and signature, then atomically set boot partition.
4. On first boot, check sensor, calibration, NVS and durable outbox health before marking image valid. Roll back on failure; never erase pending scale events.
5. Prevent rollback/downgrade through an explicit signed policy; test interrupted download, power loss, reboot and out-of-space behavior on real XIAO hardware.
6. Run firmware native tests and both XIAO build targets; conduct physical bench validation before allowing unattended operation near pets.

**Safety boundary:** `Verdict::Allowed` from the pure policy is a necessary *preflight* condition, never authorization to flash. This PR adds no caller that can write firmware.
