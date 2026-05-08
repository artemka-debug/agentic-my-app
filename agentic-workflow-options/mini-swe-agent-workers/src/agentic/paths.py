"""Filesystem layout under `<repo>/.agentic-runs/<run-id>/`."""

from __future__ import annotations

from pathlib import Path


RUN_ROOT_NAME = ".agentic-runs"


def agentic_runs_dir(repo_root: Path) -> Path:
    return repo_root / RUN_ROOT_NAME


def run_dir(repo_root: Path, run_id: str) -> Path:
    return agentic_runs_dir(repo_root) / run_id


def state_path(repo_root: Path, run_id: str) -> Path:
    return run_dir(repo_root, run_id) / "state.json"


def task_packet_path(repo_root: Path, run_id: str) -> Path:
    return run_dir(repo_root, run_id) / "task-packet.json"


def orchestrator_log_path(repo_root: Path, run_id: str) -> Path:
    return run_dir(repo_root, run_id) / "logs" / "orchestrator.log"


def worktrees_root(repo_root: Path, run_id: str) -> Path:
    return run_dir(repo_root, run_id) / "worktrees"


def candidate_worktree(repo_root: Path, run_id: str, candidate_id: str) -> Path:
    return worktrees_root(repo_root, run_id) / candidate_id


def artifacts_dir(repo_root: Path, run_id: str) -> Path:
    return run_dir(repo_root, run_id) / "artifacts"


def verification_dir(repo_root: Path, run_id: str) -> Path:
    return run_dir(repo_root, run_id) / "verification"


def final_dir(repo_root: Path, run_id: str) -> Path:
    return run_dir(repo_root, run_id) / "final"


def candidates_dir(repo_root: Path, run_id: str) -> Path:
    return run_dir(repo_root, run_id) / "candidates"


def ensure_run_layout(repo_root: Path, run_id: str) -> Path:
    """Create canonical directories for a run. Returns the run directory."""
    root = run_dir(repo_root, run_id)
    for sub in (
        root / "logs",
        root / "artifacts",
        root / "worktrees",
        root / "verification",
        root / "final",
        root / "candidates",
    ):
        sub.mkdir(parents=True, exist_ok=True)
    return root
