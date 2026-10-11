# Cat silhouettes

Masters: twelve black-on-transparent PNGs from feedme (`firmware/design/cats4`), one per pose A1–C4 (spec §1.7). `render.py` trims each to its alpha bounding box, pads to a square with 6% margin, and writes 256 px alpha masks to `webapp/public/cats/` (the web tints them with CSS `mask-image`) — and, from Phase 2, 130/88 px white PNGs as C arrays for the firmware. Rerun after changing a master:

    python assets/cats/render.py
