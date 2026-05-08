from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in override.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def default_config_path(package_root: Path) -> Path:
    return package_root / "config" / "default.agentic-task.yaml"


def load_config(
    cwd: Path | None = None,
    package_root: Path | None = None,
) -> dict[str, Any]:
    """Load merged config: packaged default < optional user files."""
    cwd = cwd or Path.cwd()
    if package_root is None:
        package_root = Path(__file__).resolve().parent.parent.parent

    default_path = default_config_path(package_root)
    with default_path.open(encoding="utf-8") as f:
        cfg: dict[str, Any] = yaml.safe_load(f) or {}

    env_path = os.environ.get("AGENTIC_TASK_CONFIG")
    if env_path:
        p = Path(env_path).expanduser()
        if p.is_file():
            with p.open(encoding="utf-8") as f:
                cfg = _deep_merge(cfg, yaml.safe_load(f) or {})

    for candidate in (cwd / "agentic-task.yaml", cwd / ".agentic-task.yaml"):
        if candidate.is_file():
            with candidate.open(encoding="utf-8") as f:
                cfg = _deep_merge(cfg, yaml.safe_load(f) or {})
            break

    return cfg


def artifacts_dir(cfg: dict[str, Any], cwd: Path | None = None) -> Path:
    cwd = cwd or Path.cwd()
    rel = (cfg.get("artifacts") or {}).get("directory", ".agent-runs")
    return cwd / rel


def worktrees_root(cfg: dict[str, Any], cwd: Path | None = None) -> Path:
    cwd = cwd or Path.cwd()
    rel = (cfg.get("worktrees") or {}).get("root", ".worktrees")
    return cwd / rel
