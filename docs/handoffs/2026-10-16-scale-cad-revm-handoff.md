# FeedMe2 — scale CAD handoff (Rev M)

Status: concept / fit-check; **not print-ready or pet-safe**. Date: 2026-10-16.

## Mechanical requirements
- Flat removable weighing platform, maximum Ø165 mm; bowl rim reference 5–6 inches.
- Base approximately 195 × 225 × 35 mm, split into four printable sections for a 165 × 165 mm nominal XY printer bed.
- Stationary vertical camera post (no horizontal arm); height-adjustable sliding carriage; indexed tilt 30°, 45°, 60°, 75°. Camera never touches the weighed platform.
- XIAO ESP32S3 Sense / OV2640; 1 kg single-point beam; HX711 initially, NAU7802 alternative.
- Independent headless scale; optional separate Waveshare ESP32-S3 AMOLED 1.75 controller.

## Revision lineage
- Rev K: split base/lid, four-part platform Ø165, 7 mm underside structural hub, two-piece camera post.
- Rev K2: corrected camera assembly placement.
- Rev L: M3 splice clearance holes and post-coupler holes; cable fit coupons.
- Rev M: real pivot and index holes in fork and camera carrier; four angle-fit STEP configurations; 45° nominal assembled configuration. Concept assembly contains 31 solids.
- Rev M deliverables from CAD generation session: `FeedMe2_RevM_Complete.step`, individual printable STEP/STL parts, `camera_index_{30,45,60,75}deg_fit_check.step`, `camera_index_test_coupon.*`, `overload_stop_test_coupon_UNCALIBRATED.*`, `parameters.json`, `verification.json`, `README.md`; generators `build_revK_source.py`, `build_revL.py`, `build_revM.py`.

**Important:** This handoff is stored in GitHub, but the binary Rev M STEP/STL/ZIP artifacts have not been uploaded by this integration. Their current conversation artifact is `/mnt/data/FeedMe2_RevM_Camera_Index_Fit_Test.zip` (a local runtime path, not a repository file). Do not claim the repo contains the geometry until binary upload is completed.

## Open mechanical issues (block release)
1. Design and calibrate **overload stops** before exposing 1 kg load cell to pets; coupon is not a functional stop.
2. Physically verify fixed/moving beam ends, mounting hole thread/diameter/depth, screw length and clearances.
3. Validate complete load path and off-center-load performance across four platform quadrants; no parasitic contact with lid or camera.
4. Measure camera PCB/lens carrier, optical axis, ribbon length, connector orientation, cable bend envelope.
5. Print and validate pivot/index holes, pins, fastener access and each of four angle settings.
6. Validate height slider locking, post coupling strength and serviceability.
7. Design cable routing, strain relief, power/USB access and splash protection.
8. Test seam flatness, nut access, printer margins/brim/supports; CAD max dimension of 165 mm does not prove slicer fit.

## Software-relevant physical semantics
- Manual feeding is independent of the scale.
- Automatic **food addition** is the difference between stable gross weight after bowl return and stable gross weight before lifting, provided the bowl is comparable.
- Register empty bowl by placement for 3–5 seconds followed by removal; that gesture does **not** prove the bowl is empty.
- Negative delta is a food removal/correction candidate, not a feeding; food added is not food eaten.

## Next CAD acceptance criteria
Generate complete multi-body STEP, individual oriented STL files, source parameters and BOM; check collisions and assembly order; bench-check load path and overload stops; test four camera angles and slide limits; validate cable clearance and real slicer settings.

## Continuation
Obtain the binary Rev M ZIP from the original CAD conversation, then commit under `hardware/cad/revM/` or an appropriately documented Git LFS location. Keep the full CAD source as well. Never replace an existing revision without retaining provenance.
