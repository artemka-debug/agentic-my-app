"""Git repository detection and worktree helpers."""

from __future__ import annotations

import subprocess
from pathlib import Path

from agentic.subprocess_runner import run_logged


def git_top_level(start: Path | None = None, *, log_file: Path | None = None) -> Path:
    r = run_logged(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=start,
        log_file=log_file,
        timeout_seconds=30,
    )
    if r.returncode != 0:
        raise RuntimeError(
            "Not inside a git repository (git rev-parse failed). "
            f"stderr: {r.stderr.strip()}"
        )
    return Path(r.stdout.strip())


def create_worktree(
    repo_root: Path,
    *,
    path: Path,
    branch_or_commit: str,
    log_file: Path | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    r = run_logged(
        ["git", "-C", str(repo_root), "worktree", "add", "--detach", str(path), branch_or_commit],
        log_file=log_file,
        timeout_seconds=120,
    )
    if r.returncode != 0:
        raise RuntimeError(f"git worktree add failed: {r.stderr.strip()}")


def remove_worktree(repo_root: Path, path: Path, *, log_file: Path | None = None) -> None:
    r = run_logged(
        ["git", "-C", str(repo_root), "worktree", "remove", "--force", str(path)],
        log_file=log_file,
        timeout_seconds=120,
    )
    if r.returncode != 0:
        raise RuntimeError(f"git worktree remove failed: {r.stderr.strip()}")


def resolve_default_branch(repo_root: Path, *, log_file: Path | None = None) -> str:
    """Return remote default branch short name (e.g. main)."""
    r = run_logged(
        ["git", "-C", str(repo_root), "symbolic-ref", "refs/remotes/origin/HEAD"],
        log_file=log_file,
        timeout_seconds=30,
    )
    if r.returncode == 0 and r.stdout.strip():
        ref = r.stdout.strip()
        if ref.startswith("refs/remotes/origin/"):
            return ref.split("/", maxsplit=3)[-1]
    # Fallback
    for name in ("main", "master"):
        p = subprocess.run(
            ["git", "-C", str(repo_root), "rev-parse", "--verify", f"origin/{name}"],
            capture_output=True,
            text=True,
        )
        if p.returncode == 0:
            return name
    raise RuntimeError("Could not determine default branch from origin.")
