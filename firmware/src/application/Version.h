#pragma once

// Firmware version stamp (spec §6.1). Surfaced in About, in the
// heartbeat, and in the OTA check. Auto-bumped by the pre-commit hook
// (scripts/bump_versions.py rewrites ONLY the quoted string) and
// enforced by scripts/check_version_bump.py. Format: MAJOR.MINOR.PATCH.

namespace feedme2::application {

constexpr const char* kFirmwareVersion = "0.1.4";

}  // namespace feedme2::application
