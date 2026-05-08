"""YAML configuration loading and defaults (plan § Configuration Schema)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

import yaml


DEFAULT_CONFIG_NAME = "agentic.yaml"
LOCAL_CONFIG_DIR = ".agentic"


@dataclass
class GitHubSourceConfig:
    enabled: bool = True
    default_repo: str | None = None  # owner/repo
    token_env: str = "GITHUB_TOKEN"


@dataclass
class WorkersConfig:
    """Worker backend entries; commands resolved at fanout time."""

    backends: list[dict[str, Any]] = field(
        default_factory=lambda: [
            {"id": "cursor-local", "command": "cursor-agent-local", "enabled": True},
            {"id": "mini-swe-agent", "command": "mini-swe-agent run", "enabled": True},
            {"id": "swe-agent", "command": "swe-agent run", "enabled": False},
        ]
    )
    selection_strategy: str = "diverse-parallel"


@dataclass
class ExecutionConfig:
    mode: str = "local-only"
    harness: str = "cursor"
    sandbox: str = "worktree"
    max_parallel_workers: int = 4
    default_timeout_minutes: int = 45
    allow_cloud_execution: bool = False


@dataclass
class AgenticConfig:
    version: int = 1
    execution: ExecutionConfig = field(default_factory=ExecutionConfig)
    sources: dict[str, Any] = field(default_factory=dict)
    github_source: GitHubSourceConfig = field(default_factory=GitHubSourceConfig)
    workers: WorkersConfig = field(default_factory=WorkersConfig)
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def default(cls) -> AgenticConfig:
        return cls()

    @classmethod
    def load(cls, path: Path | None = None, repo_root: Path | None = None) -> AgenticConfig:
        candidates: list[Path] = []
        if path:
            candidates.append(path)
        if repo_root:
            candidates.append(repo_root / LOCAL_CONFIG_DIR / DEFAULT_CONFIG_NAME)
            candidates.append(repo_root / DEFAULT_CONFIG_NAME)
        data: dict[str, Any] | None = None
        loaded_from: Path | None = None
        for p in candidates:
            if p.is_file():
                loaded_from = p
                raw = yaml.safe_load(p.read_text(encoding="utf-8"))
                data = raw if isinstance(raw, Mapping) else None
                break
        if data is None:
            return cls()
        if not isinstance(data, Mapping):
            raise ValueError(f"Config must be a mapping: {loaded_from or path}")

        exec_raw = data.get("execution") or {}
        sources_raw = data.get("sources") or {}
        gh_raw = sources_raw.get("github") or {}
        workers_raw = data.get("workers") or {}

        execution = ExecutionConfig(
            mode=str(exec_raw.get("mode", "local-only")),
            harness=str(exec_raw.get("harness", "cursor")),
            sandbox=str(exec_raw.get("sandbox", "worktree")),
            max_parallel_workers=int(exec_raw.get("max_parallel_workers", 4)),
            default_timeout_minutes=int(exec_raw.get("default_timeout_minutes", 45)),
            allow_cloud_execution=bool(exec_raw.get("allow_cloud_execution", False)),
        )
        gh = GitHubSourceConfig(
            enabled=bool(gh_raw.get("enabled", True)),
            default_repo=gh_raw.get("default_repo"),
            token_env=str(gh_raw.get("token_env", "GITHUB_TOKEN")),
        )
        backends = workers_raw.get("backends")
        if backends is None:
            backends = WorkersConfig().backends
        workers = WorkersConfig(
            backends=list(backends),
            selection_strategy=str(workers_raw.get("selection_strategy", "diverse-parallel")),
        )
        return cls(
            version=int(data.get("version", 1)),
            execution=execution,
            sources=dict(sources_raw),
            github_source=gh,
            workers=workers,
            raw=dict(data),
        )
