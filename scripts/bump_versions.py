#!/usr/bin/env python3
"""Auto-bump tier versions for STAGED changes. Runs as the pre-commit
hook (.githooks/pre-commit); safe to run by hand before committing:

    python3 scripts/bump_versions.py

For each tier (webapp, worker, firmware — see version_rules.TIERS): if
the staged diff touches that tier and does NOT already change its
version file (webapp/worker: package.json `.version`; firmware:
kFirmwareVersion in Version.h), bump the patch version so it rides
along in the same commit. shared/ changes count for both webapp and
worker; fixtures/ changes count for firmware.

The schema tier needs no bumping — a new numbered migration file is
its version (check_version_bump.py enforces that on PRs).

Unstaged edits are preserved. The bump touches exactly two things:

  * the index entry for the tier's version file, rewritten from its
    STAGED content so the bump composes with what is being committed;
  * the version field of the worktree copy, edited in place.

Every other byte of the worktree file — including edits you have not
staged yet — is left alone. Notably the index is updated via
`git update-index`, NOT `git add`: `git add` would stage the worktree
copy, dragging unstaged edits into the commit, and writing the bumped
staged content over the worktree would destroy them outright.

All file/blob I/O is byte-exact. Python's text mode applies universal
newline translation on read and os.linesep translation on write, which
would silently rewrite every line ending in the file.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from version_rules import TIERS, Tier, bump_patch


def _git(repo: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(repo), *args], stderr=subprocess.PIPE
    ).decode("utf-8")


def _git_stdin(repo: Path, payload: bytes, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    ).stdout.decode("utf-8")


def _staged_files(repo: Path) -> list[str]:
    out = _git(repo, "diff", "--cached", "--name-only")
    return [line.strip() for line in out.splitlines() if line.strip()]


def _show(repo: Path, spec: str) -> str | None:
    """`git show <spec>` — None when the object doesn't exist (e.g.
    the file is new in this commit)."""
    try:
        return _git(repo, "show", spec)
    except subprocess.CalledProcessError:
        return None


def _stage_blob(repo: Path, rel: str, content: str) -> None:
    """Put `content` in the index at `rel` without reading — or
    touching — the worktree copy.

    `--no-filters` is correct here because `content` came out of the
    index already (i.e. it is post-clean blob content); re-running the
    clean filter on it would be a double conversion.
    """
    stage = _git(repo, "ls-files", "--stage", "--", rel).strip()
    if not stage:
        raise RuntimeError(f"{rel} is not in the index")
    mode = stage.split()[0]
    sha = _git_stdin(
        repo, content.encode("utf-8"), "hash-object", "-w", "--no-filters", "--stdin"
    ).strip()
    _git(repo, "update-index", "--add", "--cacheinfo", f"{mode},{sha},{rel}")


def _bump_worktree(repo: Path, tier: Tier, staged_v: str, new_v: str) -> None:
    """Edit the version field of the worktree copy in place, leaving
    the rest of the file (unstaged edits included) untouched."""
    path = repo / tier.version_file
    if not path.exists():
        return
    content = path.read_bytes().decode("utf-8")
    if tier.read(content) != staged_v:
        # The worktree version already differs from the staged one, so
        # an unstaged edit (or an unparsable file) is in play. Retyping
        # the field would destroy it — leave the file alone and say so
        # loudly. The index still gets the bump.
        # ASCII only: this runs inside a pre-commit hook, where a
        # UnicodeEncodeError on a narrow console codepage would abort
        # the commit.
        print(
            f"[bump_versions] {tier.version_file}: worktree version differs "
            f"from the staged one - worktree left untouched, index staged at "
            f"{new_v}. Reconcile the file by hand.",
            file=sys.stderr,
        )
        return
    path.write_bytes(tier.write(content, new_v).encode("utf-8"))


def run(repo: Path) -> list[str]:
    """Bump every tier the staged diff touches. Returns bumped tier
    names (empty when nothing needed)."""
    staged = _staged_files(repo)
    if not staged:
        return []

    bumped: list[str] = []
    for tier in TIERS:
        if not any(tier.matches(p) for p in staged):
            continue

        rel = tier.version_file
        staged_src = _show(repo, f":{rel}")
        head_src = _show(repo, f"HEAD:{rel}")
        staged_v = tier.read(staged_src) if staged_src is not None else None
        head_v = tier.read(head_src) if head_src is not None else None
        if staged_v is None:
            # Version file missing/unparsable in the index - say so, then
            # leave it to the CI check to complain with full context.
            print(
                f"[bump_versions] {tier.name}: {rel} missing or unparsable in "
                f"the index - not bumped (CI version-check will flag it).",
                file=sys.stderr,
            )
            continue
        if head_v is None or staged_v != head_v:
            # New file, or already bumped in this commit — done.
            continue

        new_v = bump_patch(staged_v)
        assert staged_src is not None
        # Index first: it is what the commit records. If the worktree
        # write then fails the hook aborts the commit, and the next
        # run finds the version already bumped and no-ops.
        _stage_blob(repo, rel, tier.write(staged_src, new_v))
        _bump_worktree(repo, tier, staged_v, new_v)
        bumped.append(tier.name)
    return bumped


def main() -> int:
    repo = Path(
        subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], text=True
        ).strip()
    )
    for name in run(repo):
        print(f"[bump_versions] {name}: patch version bumped (staged)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
