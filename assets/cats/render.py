#!/usr/bin/env python3
"""Render the cat masters into the sizes each tier needs. Requires Pillow."""
from __future__ import annotations
import math
import subprocess
import sys
import tempfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "assets" / "cats"
WEB = ROOT / "webapp" / "public" / "cats"
POSES = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "C1", "C2", "C3", "C4"]
WEB_PX = 256
# Firmware: 130 px idle avatar, 88 px fed / "all cats" avatars (spec D2).
FW_SIZES = (130, 88)
FW_DIR = ROOT / "firmware" / "src" / "assets" / "cats"
PNG_TO_C = ROOT / "firmware" / "scripts" / "png_to_c.py"
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


def render_firmware(squared: Image.Image, pose: str, px: int) -> None:
    alpha = squared.resize((px, px), Image.LANCZOS).getchannel("A")
    # White on transparent: LVGL recolors it to the cat colour at draw time.
    out = Image.new("RGBA", (px, px), (255, 255, 255, 0))
    out.putalpha(alpha)
    symbol = f"cat_{pose.lower()}_{px}"
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / f"{symbol}.png"
        out.save(png, optimize=True)
        c_file = FW_DIR / f"cat_{pose}_{px}.c"
        subprocess.run([sys.executable, str(PNG_TO_C), str(png), symbol, str(c_file)], check=True)
        print(f"  firmware cat_{pose}_{px}.c ({png.stat().st_size} B png)")


def main() -> None:
    WEB.mkdir(parents=True, exist_ok=True)
    for pose in POSES:
        with Image.open(SRC / f"{pose}.png") as master:
            squared = square_crop(master, pose)
        sq = squared.resize((WEB_PX, WEB_PX), Image.LANCZOS)
        # Alpha mask: colour is irrelevant for mask-image, keep it black.
        out = Image.new("RGBA", sq.size, (0, 0, 0, 0))
        out.putalpha(sq.getchannel("A"))
        out.save(WEB / f"{pose}.png", optimize=True)
        print(f"  cats/{pose}.png")
        for px in FW_SIZES:
            render_firmware(squared, pose, px)


if __name__ == "__main__":
    main()
