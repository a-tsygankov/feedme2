# FeedMe2 Rev M — CAD artifact manifest

**Status:** binary models awaiting upload. The source-of-truth handoff is [CAD Rev M handoff](../../../docs/handoffs/2026-10-16-scale-cad-revm-handoff.md). Do not interpret this directory as containing complete CAD deliverables yet.

## Required files from the CAD session
- `FeedMe2_RevM_Complete.step` — multi-solid assembly, nominal 45° camera position.
- All individual `*.step` and `*.stl` printable bodies from `feedme2_cad_revM/`, including four-part base, four-part lid, four-part platform, central structural hub, camera post and coupling, camera fork and carrier, splices and fit coupons.
- `camera_index_30deg_fit_check.step`, `camera_index_45deg_fit_check.step`, `camera_index_60deg_fit_check.step`, `camera_index_75deg_fit_check.step`.
- `overload_stop_test_coupon_UNCALIBRATED.step` and `.stl` — coupon only, not a calibrated safety stop.
- `parameters.json`, `verification.json`, CAD `README.md`.
- Generator source files: `build_revK_source.py`, `build_revL.py`, `build_revM.py`.

Original bundle name: `FeedMe2_RevM_Camera_Index_Fit_Test.zip` (available as a conversation artifact, not uploaded here).

## Upload checklist
1. Upload the original bundle and source files without modifying geometry.
2. Check file sizes and hashes, and record them in this manifest.
3. Consider Git LFS for binary STEP/STL if repository policy supports it; otherwise commit a versioned ZIP or GitHub Release asset.
4. Verify STEP imports and slicer dimensions; printer bed 165 × 165 mm is nominal, not a guaranteed printable margin.
5. **Do not label Rev M production-ready**: overload stops, load path, camera ribbon and fit tolerances are unvalidated.

The generated STEP is not a native parametric Onshape Assembly.
