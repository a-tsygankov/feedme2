# Scale domain foundation — first implementation slice

Base: `main` 3568252 (2026-10-18). This branch intentionally adds **only pure TypeScript domain logic and tests**, without database migrations, firmware, or API route changes.

## Implemented
- `shared/src/scale.ts`: integer milligram schema for stable observations, bowl profiles, pure transition reducer, explicit positive/negative delta and calibration mismatch handling.
- `shared/src/scale.test.ts`: tests for addition, removal, calibration change, invalid/unstable readings, absent state, bowl tolerance and fault.

## Known limitations / next tasks
- Stable sample detection and bowl presence are hardware-dependent and not implemented.
- State reducer is a **prototype**, not yet a complete idempotent event processor: persist sequence checkpoints, enforce ordering and deduplicate before use.
- Profile matching is intentionally separate from lift/return; a matching profile must be required before an inferred addition can be accepted.
- The maximum schema weight is 1,000,000 mg as a conservative sensor range; gross assembly tare and 1 kg overload calibration may require different safety rules.
- Firmware should implement equivalent logic in pure C++ with cross-language fixtures.
- Backend requires new migration and authenticated bounded batch endpoint; do not reuse `/api/device/feedings`.
- Add explicit tests for startup with bowl present, replacement with a different bowl, sensor overload and reboot.
- These tests are authored but **not executed in GitHub by this connector**; require CI results before merge.

See `docs/architecture/scale-camera-integration.md` in PR #7 for the broader proposed architecture.
