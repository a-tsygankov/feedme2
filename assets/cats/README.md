# Cat silhouettes

Masters: twelve black-on-transparent PNGs from feedme (`firmware/design/cats4`), one per pose A1–C4 (spec §1.7). `render.py` trims each to its alpha bounding box, pads to a square with 6% margin, and writes 256 px alpha masks to `webapp/public/cats/` (the web tints them with CSS `mask-image`) — and, from Phase 2, 130/88 px white PNGs as C arrays for the firmware. Rerun after changing a master:

    pip install pillow==12.0.0
    python assets/cats/render.py

The output is deterministic for a given Pillow and zlib build, so a second run is byte-identical; a different Pillow or zlib version can re-encode the PNGs differently (same pixels, different bytes). Use the pinned version above before committing re-rendered PNGs.

## Firmware outputs

For each pose `render.py` also writes `firmware/src/assets/cats/cat_<pose>_130.c` (idle avatar) and `cat_<pose>_88.c` (fed screen, "all cats"): the same trimmed, padded silhouette resized to 130 / 88 px, white RGB with the silhouette as alpha, PNG-encoded with `optimize=True`. `firmware/scripts/png_to_c.py <png> <symbol> <out.c>` wraps the PNG bytes in a `static const uint8_t <symbol>_map[]` and an `lv_image_dsc_t <symbol>` with `LV_COLOR_FORMAT_RAW`, so LVGL's lodepng decoder (`LV_USE_LODEPNG 1`) inflates it at draw time; the firmware tints it with `lv_obj_set_style_image_recolor`. `firmware/src/assets/cats/CatAssets.h` (hand-written) declares the 24 descriptors and `catImage(slug, size)`.

Sizes: about 73 KB of PNG bytes in total (about 74 KB of flash), about 262 KiB of generated C source (decimal byte lists). The `.c` files are committed; like the web masks they are byte-identical on re-run for a given Pillow and zlib build (no timestamps), so use the pinned Pillow before committing. Check with `git status` after a rerun: nothing under `webapp/public/cats/` or `firmware/src/assets/cats/` should change.
