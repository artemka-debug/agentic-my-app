"""High-level run bookkeeping over SQL + filesystem."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from orchestrator.artifacts import ensure_run_artifact_dirs
from orchestrator.config import OrchestratorConfig, resolve_artifact_root, resolve_db_path
from orchestrator.db.models import EventRow, RunRow


def new_run_id() -> str:
    return f"run_{uuid.uuid4().hex[:12]}"


def insert_run(
    session: Session,
    *,
    run_id: str,
    thread_id: str,
    workspace_root: Path,
) -> RunRow:
    row = RunRow(
        id=run_id,
        status="running",
        thread_id=thread_id,
        workspace_root=str(workspace_root),
        current_node=None,
    )
    session.add(row)
    session.flush()
    return row


def record_event(session: Session, run_id: str, kind: str, payload: dict | None = None) -> None:
    session.add(
        EventRow(
            run_id=run_id,
            kind=kind,
            payload_json=json.dumps(payload) if payload else None,
        )
    )


def prepare_run_paths(config: OrchestratorConfig, cwd: Path, run_id: str) -> tuple[Path, Path]:
    db_path = resolve_db_path(config, cwd)
    art_root = resolve_artifact_root(config, cwd)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    art_root.mkdir(parents=True, exist_ok=True)
    ensure_run_artifact_dirs(art_root, run_id)
    return db_path, art_root
