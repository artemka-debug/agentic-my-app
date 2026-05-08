"""Build and compile the Phase 1 LangGraph."""

from __future__ import annotations

from pathlib import Path

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, StateGraph

from orchestrator.graph.nodes import (
    decomposition_node,
    intake_node,
    po_clarification_node,
)
from orchestrator.graph.state import OrchestratorState


def build_graph(sqlite_db_path: Path):
    """Compile graph with SQLite checkpointer (LangGraph-managed tables)."""
    g = StateGraph(OrchestratorState)
    g.add_node("intake", intake_node)
    g.add_node("po_clarification", po_clarification_node)
    g.add_node("decomposition", decomposition_node)
    g.set_entry_point("intake")
    g.add_edge("intake", "po_clarification")
    g.add_edge("po_clarification", "decomposition")
    g.add_edge("decomposition", END)

    conn = f"sqlite:///{sqlite_db_path.resolve()}"
    checkpointer = SqliteSaver.from_conn_string(conn)
    return g.compile(checkpointer=checkpointer)
