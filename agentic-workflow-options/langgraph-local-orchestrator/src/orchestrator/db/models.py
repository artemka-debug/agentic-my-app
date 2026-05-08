"""SQLAlchemy models — aligns with docs/plan.md §18.1."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class RunRow(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    thread_id: Mapped[str] = mapped_column(String(128), unique=True)
    workspace_root: Mapped[str] = mapped_column(Text, default="")
    current_node: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    checkpoints: Mapped[list[GraphCheckpointRow]] = relationship(back_populates="run")
    approvals: Mapped[list[ApprovalRow]] = relationship(back_populates="run")
    candidates: Mapped[list[CandidateRow]] = relationship(back_populates="run")
    verification_reports: Mapped[list[VerificationReportRow]] = relationship(
        back_populates="run"
    )
    events: Mapped[list[EventRow]] = relationship(back_populates="run")
    errors: Mapped[list[ErrorRow]] = relationship(back_populates="run")
    artifacts: Mapped[list[ArtifactRow]] = relationship(back_populates="run")


class GraphCheckpointRow(Base):
    __tablename__ = "graph_checkpoints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(64), ForeignKey("runs.id"))
    checkpoint_ns: Mapped[str] = mapped_column(String(256), default="")
    langgraph_checkpoint_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    parent_checkpoint_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    node: Mapped[str | None] = mapped_column(String(128), nullable=True)
    state_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    blob: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    run: Mapped[RunRow] = relationship(back_populates="checkpoints")


class ApprovalRow(Base):
    __tablename__ = "approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(64), ForeignKey("runs.id"))
    gate: Mapped[str] = mapped_column(String(64))
    decision: Mapped[str] = mapped_column(String(32))
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    run: Mapped[RunRow] = relationship(back_populates="approvals")


class CandidateRow(Base):
    __tablename__ = "candidates"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), ForeignKey("runs.id"))
    branch: Mapped[str | None] = mapped_column(String(256), nullable=True)
    worktree_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    meta_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    run: Mapped[RunRow] = relationship(back_populates="candidates")


class VerificationReportRow(Base):
    __tablename__ = "verification_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(64), ForeignKey("runs.id"))
    candidate_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32))
    report_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    run: Mapped[RunRow] = relationship(back_populates="verification_reports")


class EventRow(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(64), ForeignKey("runs.id"))
    kind: Mapped[str] = mapped_column(String(64))
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    run: Mapped[RunRow] = relationship(back_populates="events")


class ErrorRow(Base):
    __tablename__ = "errors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(64), ForeignKey("runs.id"))
    node: Mapped[str | None] = mapped_column(String(128), nullable=True)
    message: Mapped[str] = mapped_column(Text)
    detail_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    run: Mapped[RunRow] = relationship(back_populates="errors")


class ArtifactRow(Base):
    __tablename__ = "artifacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(64), ForeignKey("runs.id"))
    path: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(64))
    meta_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    run: Mapped[RunRow] = relationship(back_populates="artifacts")


def create_engine_and_session(db_url: str):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(db_url, echo=False, future=True)
    Session = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    return engine, Session
