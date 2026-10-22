#!/usr/bin/env python3
"""Stage the original FeedMe2 Rev M ZIP under hardware/cad/revM/.

Usage:
  python scripts/stage_revm_cad.py /path/to/FeedMe2_RevM_Camera_Index_Fit_Test.zip
  git add hardware/cad/revM
  git commit -m "chore(cad): archive original Rev M STEP and STL artifacts"
  git push

Does not overwrite or regenerate the original CAD geometry.
"""
from __future__ import annotations

import hashlib
import shutil
import sys
from pathlib import Path
from zipfile import ZipFile

EXPECTED_SHA256 = "6f0da7e94022efc4bb3c48947bcfd2ae4b0a9e3de1605bfbb7194e4a0ae62f7f"
EXPECTED_STEP_SHA256 = "c273dd9a7df85c0b8a8a79a3c938e3368ea608b51fe29b8b2b92e310a55d5a24"
ZIP_NAME = "FeedMe2_RevM_Camera_Index_Fit_Test.zip"
STEP_IN_ZIP = "FeedMe2_RevM/FeedMe2_RevM_Complete.step"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(f"Usage: {sys.argv[0]} /path/to/{ZIP_NAME}")
    source = Path(sys.argv[1]).expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"File not found: {source}")
    if sha256(source) != EXPECTED_SHA256:
        raise SystemExit("SHA256 mismatch: this is not the reviewed original Rev M bundle")
    root = Path(__file__).resolve().parents[1]
    destination = root / "hardware" / "cad" / "revM"
    destination.mkdir(parents=True, exist_ok=True)
    with ZipFile(source) as archive:
        if STEP_IN_ZIP not in archive.namelist():
            raise SystemExit("Missing expected STEP assembly in archive")
        actual = hashlib.sha256(archive.read(STEP_IN_ZIP)).hexdigest()
        if actual != EXPECTED_STEP_SHA256:
            raise SystemExit("Assembly STEP checksum mismatch")
        for info in archive.infolist():
            if info.is_dir():
                continue
            if not info.filename.startswith("FeedMe2_RevM/"):
                raise SystemExit("Unexpected archive path")
            relative = Path(info.filename).relative_to("FeedMe2_RevM")
            if relative.is_absolute() or ".." in relative.parts:
                raise SystemExit("Unsafe archive path")
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as inp, target.open("wb") as out:
                shutil.copyfileobj(inp, out)
    shutil.copy2(source, destination / ZIP_NAME)
    print(f"Staged {ZIP_NAME} and all extracted parts in {destination}")
    print("Review git status before committing; these binaries are not yet pushed.")


if __name__ == "__main__":
    main()
