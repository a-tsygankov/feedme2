# PWA update and XIAO scale OTA audit (2026-10-18)

## Scope

Reviewed the code on `main` after PR #16. This audit distinguishes **build-time version stamps**, **PWA software updates**, and **actual firmware OTA**. CI compilation alone does not prove a browser update or an OTA flash on physical hardware.

## PWA: implemented, with a startup/uncontrolled-page fix

- `webapp/vite.config.ts` emits `/version.json` from the webapp package version and deliberately excludes it from Workbox precaching. The browser requests it with `cache: "no-store"` and a cache-busting query.
- `webapp/src/lib/pwa-update-browser.ts` registers `/sw.js`, checks for an installed waiting worker, polls `/version.json` every ten minutes while visible, and checks again on `visibilitychange`. A controlled page prompts via `UpdateBar` and sends `SKIP_WAITING` only on the user's Reload action; `controllerchange` reloads the requesting tab.
- **Fixed in this PR:** the initial check now runs immediately after SW registration settles (or immediately if SW is unsupported). When a newer build is served to an *uncontrolled* page, it offers a normal reload instead of relying on a `controllerchange` that may not happen. Rejected `registration.update()` calls are logged instead of becoming unhandled rejections. A dismissed reload-only offer for the same version stays dismissed on later polls.
- **Not guaranteed:** iOS may suspend a background PWA; checks occur only while the app is running. User confirmation remains required; this is not silent background replacement. Validate on installed iOS Safari/Home Screen and Android Chrome with a real deployment, including offline reopen, dirty forms, multiple tabs, and version transitions.

## XIAO ESP32-S3 Sense scale: OTA is **not implemented**

- `firmware/src/application/Version.h` declares a build version (0.1.40 at audit). `ScaleNetService` sends it during pairing, but never polls for a firmware release.
- `backend/src/routes/version.ts` exposes `firmware.latest`, but `backend/src/version.ts` reads the future `firmware_releases` table and returns **null** if that table does not exist. There is no release publication, signed manifest, or authenticated binary endpoint for XIAO.
- `firmware/src/adapters/XiaoHttps.cpp` only implements pairing and `POST /api/device/scale-events`. No OTA download, signature/hash verification, update partition write, boot validation or rollback orchestration exists.
- `firmware/partitions/xiao_8mb.csv` reserves two 3 MiB app slots and `otadata`; this is a **partition layout prerequisite**, not a functioning updater. Changing the partition layout can invalidate flash data and must not be performed remotely without a verified migration path.
- The existing CrowPanel app's About/version UI and any comments mentioning an OTA check are not evidence that XIAO scale OTA works.

## Required OTA implementation before enabling on hardware

1. Establish a **per-hardware-model** release registry (XIAO scale vs CrowPanel), signed immutable release metadata, image size, SHA-256, version, minimum bootloader/partition layout and an explicit rollout channel. Keep unsigned/unknown releases rejected.
2. Build a CA-validated, hostname-pinned-to-approved-domain transport for manifest and image download; verify authenticity with a provisioned public key (not just TLS or a plain hash from the same server), reject downgrades/replays, bound all sizes and redirects.
3. Implement streaming writes to the inactive OTA partition, complete integrity check before selecting the new boot slot, power-loss handling, first-boot self-test, explicit rollback and post-update version/health reporting. Do **not** erase LittleFS observations, NVS calibration, Wi-Fi or pairing tokens.
4. Enforce battery/power and physical safety gates, stop active bowl-watch transitions during upgrade, and never auto-update while pending critical observations cannot be preserved. Operator confirmation for initial bench releases.
5. Add native manifest-policy tests, simulated truncated/corrupt images, power-cut and reboot recovery tests, and **physical XIAO flash/rollback verification** before declaring OTA production-ready.

Until then: update XIAO only through supervised USB flashing and the documented partition/calibration precautions. **No unattended pet use** without mechanical overload stops and validated physical tests.
