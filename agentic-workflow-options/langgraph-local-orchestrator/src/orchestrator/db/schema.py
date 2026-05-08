"""Database initialization."""

from __future__ import annotations

from orchestrator.db.models import Base


def init_db(engine) -> None:
    Base.metadata.create_all(engine)
