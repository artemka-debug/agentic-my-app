"""Artifact directory layout (docs/plan.md §8.1, §19)."""

from __future__ import annotations

import json
from pathlib import Path


def ensure_run_artifact_dirs(artifact_root: Path, run_id: str) -> Path:
    """
    Creates:
      {artifact_root}/runs/{run_id}/
        candidates/
        logs/
    """
    base = artifact_root / "runs" / run_id
    (base / "candidates").mkdir(parents=True, exist_ok=True)
    (base / "logs").mkdir(parents=True, exist_ok=True)
    manifest = {
        "runId": run_id,
        "layoutVersion": 1,
        "paths": {
            "root": str(base),
            "candidates": str(base / "candidates"),
            "logs": str(base / "logs"),
        },
    }
    (base / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return base
