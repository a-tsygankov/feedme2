#!/usr/bin/env python3
"""Render the cat masters into the sizes each tier needs. Requires Pillow."""
from __future__ import annotations
import math
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "assets" / "cats"
WEB = ROOT / "webapp" / "public" / "cats"
POSES = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "C1", "C2", "C3", "C4"]
WEB_PX = 256
MARGIN = 0.06


def square_crop(img: Image.Image, name: str) -> Image.Image:
    img = img.convert("RGBA")
    # Threshold the alpha: anti-aliasing fringe and stray near-transparent
    # pixels would otherwise inflate the bbox and shrink the cat inside its square.
    alpha = img.getchannel("A").point(lambda a: 255 if a > 8 else 0)
    bbox = alpha.getbbox()
    if bbox is None:
        raise SystemExit(f"{name}: empty alpha")
    img = img.crop(bbox)
    # ceil, not int(): truncation could leave the margin fractionally under MARGIN.
    side = math.ceil(max(img.size) * (1 + 2 * MARGIN))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    return canvas


def main() -> None:
    WEB.mkdir(parents=True, exist_ok=True)
    for pose in POSES:
        with Image.open(SRC / f"{pose}.png") as master:
            sq = square_crop(master, pose).resize((WEB_PX, WEB_PX), Image.LANCZOS)
        # Alpha mask: colour is irrelevant for mask-image, keep it black.
        out = Image.new("RGBA", sq.size, (0, 0, 0, 0))
        out.putalpha(sq.getchannel("A"))
        out.save(WEB / f"{pose}.png", optimize=True)
        print(f"  cats/{pose}.png")


if __name__ == "__main__":
    main()
