from __future__ import annotations

import os
from pathlib import Path


def repo_root() -> Path:
    """Best-effort cwd; callers may override with AGENTIC_REPO_ROOT."""
    env = os.environ.get("AGENTIC_REPO_ROOT")
    if env:
        return Path(env).resolve()
    return Path.cwd().resolve()


def agentic_dir(root: Path | None = None) -> Path:
    return (root or repo_root()) / ".agentic"


def runs_dir(root: Path | None = None) -> Path:
    return agentic_dir(root) / "runs"


def orchestrator_root() -> Path:
    """Directory containing this package's bundled assets (config template, state machine)."""
    return Path(__file__).resolve().parent.parent


def bundled_config_template() -> Path:
    """Packaged copy of `.agentic/config.yaml` defaults (ships with the wheel)."""
    return Path(__file__).resolve().parent / "templates" / "config.template.yaml"
