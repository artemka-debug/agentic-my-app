from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


RUN_ID_RE = re.compile(r"^run-\d{4}-\d{2}-\d{2}-\d{6}$")


def new_run_id(now: datetime | None = None) -> str:
    dt = now or datetime.now(tz=timezone.utc)
    return dt.strftime("run-%Y-%m-%d-%H%M%S")


def ensure_run_dir(runs_root: Path, run_id: str) -> Path:
    if not RUN_ID_RE.match(run_id):
        raise ValueError(f"Invalid run_id format: {run_id!r}")
    d = runs_root / run_id
    (d / "workers").mkdir(parents=True, exist_ok=True)
    (d / "verification").mkdir(parents=True, exist_ok=True)
    (d / "final").mkdir(parents=True, exist_ok=True)
    return d


def write_yaml(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(
            data,
            f,
            sort_keys=False,
            allow_unicode=True,
            default_flow_style=False,
        )


def read_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        out = yaml.safe_load(f)
    return out if isinstance(out, dict) else {}


@dataclass
class RunPaths:
    root: Path

    @property
    def state(self) -> Path:
        return self.root / "state.yaml"

    @property
    def intake(self) -> Path:
        return self.root / "intake.yaml"

    @property
    def requirements(self) -> Path:
        return self.root / "requirements.yaml"

    @property
    def decomposition(self) -> Path:
        return self.root / "decomposition.yaml"
