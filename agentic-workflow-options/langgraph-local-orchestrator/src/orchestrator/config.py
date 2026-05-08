"""Load and validate orchestrator YAML config."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field


DEFAULT_CONFIG_NAME = "orchestrator.config.yaml"


class RepoConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    root: str = "."
    base_branch: str = Field(default="main", alias="baseBranch")
    remote: str = "origin"


class PersistenceConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    sqlite_path: str = Field(default=".orchestrator/state.sqlite", alias="sqlitePath")
    artifact_dir: str = Field(default=".orchestrator/artifacts", alias="artifactDir")


class LoggingConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    level: str = "info"
    jsonl: bool = True


class ApprovalsConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    require_spec_approval: bool = Field(default=True, alias="requireSpecApproval")
    require_decomposition_approval: bool = Field(
        default=True, alias="requireDecompositionApproval"
    )
    require_final_pr_approval: bool = Field(default=False, alias="requireFinalPrApproval")
    allow_assumptions_without_clarification: bool = Field(
        default=False, alias="allowAssumptionsWithoutClarification"
    )


class OrchestratorConfig(BaseModel):
    """Subset of full plan schema; extended in later phases."""

    model_config = ConfigDict(populate_by_name=True)

    repo: RepoConfig = Field(default_factory=RepoConfig)
    persistence: PersistenceConfig = Field(default_factory=PersistenceConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    approvals: ApprovalsConfig = Field(default_factory=ApprovalsConfig)
    raw: dict[str, Any] = Field(default_factory=dict, exclude=True)


def load_config(path: Path | None = None, cwd: Path | None = None) -> OrchestratorConfig:
    """Load YAML config; defaults are used for missing keys."""
    cwd = cwd or Path.cwd()
    cfg_path = path or (cwd / DEFAULT_CONFIG_NAME)
    data: dict[str, Any] = {}
    if cfg_path.is_file():
        with cfg_path.open("r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f)
            if loaded is not None:
                if not isinstance(loaded, dict):
                    raise ValueError("Config root must be a mapping")
                data = loaded
    try:
        model = OrchestratorConfig.model_validate(data)
    except Exception as e:
        raise ValueError(f"Invalid config: {e}") from e
    model.raw = data
    return model


def resolve_db_path(config: OrchestratorConfig, cwd: Path) -> Path:
    return (cwd / config.persistence.sqlite_path).resolve()


def resolve_artifact_root(config: OrchestratorConfig, cwd: Path) -> Path:
    return (cwd / config.persistence.artifact_dir).resolve()
