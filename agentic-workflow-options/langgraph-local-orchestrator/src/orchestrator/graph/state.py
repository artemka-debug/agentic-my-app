"""Shared LangGraph state (minimal Phase 1)."""

from __future__ import annotations

from typing import TypedDict


class OrchestratorState(TypedDict, total=False):
    """Graph state; extended in later phases to match plan §7."""

    run_id: str
    thread_id: str
    current_node: str
    source_kind: str
    task_title: str
    task_body: str
    po_notes: str
    decomposition_outline: str
