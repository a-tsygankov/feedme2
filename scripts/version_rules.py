#!/usr/bin/env python3
"""Single source of truth for tier/versioning rules (spec §6.1).

Consumed by:
  bump_versions.py       — pre-commit auto-bump (writes versions)
  check_version_bump.py  — CI gate (verifies versions)

Tiers and their version sources:
  webapp    webapp/package.json                 `.version`
  worker    backend/package.json                `.version`
  firmware  firmware/src/application/Version.h  kFirmwareVersion = "..."
  schema    backend/migrations/   the numbered .sql filename IS the
                                  version — no file to bump, so it has
                                  no Tier entry; both consumers
                                  special-case it via SCHEMA_DIR.

shared/ is not a tier: it is bundled into webapp and worker, so a
change there bumps both. fixtures/ ships into firmware tests and the
TS tests alike; it counts for firmware (the TS side is covered by the
shared/ rule when the vectors module changes with it).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Callable, Optional

DOC_SUFFIXES = (".md", ".txt")
DOC_PATHS = ("handoff.md", "README.md", "AGENTS.md", "CLAUDE.md", "docs/")

SCHEMA_DIR = "backend/migrations/"
SHARED_DIR = "shared/"
FIXTURES_DIR = "fixtures/"


def is_doc_file(path: str) -> bool:
    return path.endswith(DOC_SUFFIXES) or any(
        path == p or path.startswith(p) for p in DOC_PATHS
    )


def _in_shared(p: str) -> bool:
    return p.startswith(SHARED_DIR) and not is_doc_file(p)


def _in_webapp(p: str) -> bool:
    return (p.startswith("webapp/") and not is_doc_file(p)) or _in_shared(p)


def _in_worker(p: str) -> bool:
    if _in_shared(p):
        return True
    return p.startswith("backend/") and not p.startswith(SCHEMA_DIR) and not is_doc_file(p)


def _in_firmware(p: str) -> bool:
    if p.startswith(FIXTURES_DIR) and not is_doc_file(p):
        return True
    return p.startswith("firmware/") and not is_doc_file(p)


# ── version file codecs ──────────────────────────────────────────
# Each tier's version file has a reader (content → version or None)
# and a writer (content, new version → content) that touches ONLY the
# version field, so formatting, comments and line endings survive.

def read_package_json_version(content: str) -> Optional[str]:
    try:
        return str(json.loads(content)["version"])
    except (KeyError, json.JSONDecodeError):
        return None


def write_package_json_version(content: str, new_version: str) -> str:
    replaced = re.sub(
        r'("version"\s*:\s*")[^"]+(")',
        rf"\g<1>{new_version}\g<2>",
        content,
        count=1,
    )
    if read_package_json_version(replaced) != new_version:
        raise RuntimeError("failed to rewrite package.json version field")
    return replaced


_HEADER_RE = re.compile(r'(kFirmwareVersion\s*=\s*")([^"]+)(")')


def read_header_version(content: str) -> Optional[str]:
    m = _HEADER_RE.search(content)
    return m.group(2) if m else None


def write_header_version(content: str, new_version: str) -> str:
    replaced, n = _HEADER_RE.subn(rf"\g<1>{new_version}\g<3>", content, count=1)
    if n != 1 or read_header_version(replaced) != new_version:
        raise RuntimeError("failed to rewrite kFirmwareVersion")
    return replaced


@dataclass(frozen=True)
class Tier:
    name: str
    version_file: str
    read: Callable[[str], Optional[str]] = field(repr=False)
    write: Callable[[str, str], str] = field(repr=False)
    _matches: Callable[[str], bool] = field(repr=False)

    def matches(self, path: str) -> bool:
        return self._matches(path)


TIERS: list[Tier] = [
    Tier("webapp", "webapp/package.json", read_package_json_version, write_package_json_version, _in_webapp),
    Tier("worker", "backend/package.json", read_package_json_version, write_package_json_version, _in_worker),
    Tier("firmware", "firmware/src/application/Version.h", read_header_version, write_header_version, _in_firmware),
]


def bump_patch(v: str) -> str:
    """Next patch version (M.m.p → M.m.p+1). Best-effort; if the
    version doesn't look like semver we append '.1' so callers still
    produce a changed value."""
    parts = v.split(".")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        return f"{parts[0]}.{parts[1]}.{int(parts[2]) + 1}"
    return f"{v}.1"
