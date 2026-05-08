"""Worker backend stubs (Phase 5 implementations plug in here)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class WorkerBackend(Protocol):
    id: str

    def run(
        self,
        *,
        worktree_path: Path,
        task_packet: dict[str, Any],
        log_file: Path | None,
    ) -> dict[str, Any]:
        """Execute worker; returns opaque result summary dict."""
        ...


@dataclass
class CursorLocalBackend:
    id: str = "cursor-local"

    def run(
        self,
        *,
        worktree_path: Path,
        task_packet: dict[str, Any],
        log_file: Path | None,
    ) -> dict[str, Any]:
        raise NotImplementedError(
            "cursor-local backend is not wired yet (Phase 5). "
            "Configure workers.backends[].command to invoke your Cursor-local harness."
        )


@dataclass
class MiniSweAgentBackend:
    id: str = "mini-swe-agent"

    def run(
        self,
        *,
        worktree_path: Path,
        task_packet: dict[str, Any],
        log_file: Path | None,
    ) -> dict[str, Any]:
        raise NotImplementedError(
            "mini-swe-agent backend is not wired yet (Phase 5). "
            "Spawn mini-SWE-agent inside the assigned worktree with the bounded task packet."
        )


@dataclass
class SweAgentBackend:
    id: str = "swe-agent"

    def run(
        self,
        *,
        worktree_path: Path,
        task_packet: dict[str, Any],
        log_file: Path | None,
    ) -> dict[str, Any]:
        raise NotImplementedError(
            "swe-agent backend is not wired yet (Phase 5). "
            "Spawn SWE-agent inside the assigned worktree with the bounded task packet."
        )


def backend_stub(backend_id: str) -> WorkerBackend:
    bid = backend_id.strip().lower()
    if bid in {"cursor-local", "cursor_local"}:
        return CursorLocalBackend()
    if bid in {"mini-swe-agent", "mini_swe_agent"}:
        return MiniSweAgentBackend()
    if bid in {"swe-agent", "swe_agent"}:
        return SweAgentBackend()
    raise ValueError(f"Unknown worker backend id: {backend_id!r}")
