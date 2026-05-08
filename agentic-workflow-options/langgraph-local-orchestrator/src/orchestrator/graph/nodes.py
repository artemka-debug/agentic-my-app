"""Placeholder graph nodes: intake → PO clarification → decomposition."""

from __future__ import annotations

from orchestrator.graph.state import OrchestratorState


def intake_node(state: OrchestratorState) -> dict:
    """Normalize manual task into internal brief (stub)."""
    return {
        "current_node": "intake",
        "source_kind": state.get("source_kind") or "manual",
    }


def po_clarification_node(state: OrchestratorState) -> dict:
    """Product-owner style clarification (stub)."""
    body_preview = (state.get("task_body") or "")[:200]
    notes = (
        "[placeholder] PO clarification would analyze task, risks, and acceptance hints. "
        f"Body preview: {body_preview!r}"
    )
    return {"current_node": "po_clarification", "po_notes": notes}


def decomposition_node(state: OrchestratorState) -> dict:
    """Task decomposition (stub)."""
    title = state.get("task_title") or "untitled"
    outline = (
        f"[placeholder] Decomposition for {title!r}: "
        "would emit TASK-* items, sequencing, and verification hooks."
    )
    return {"current_node": "decomposition", "decomposition_outline": outline}
