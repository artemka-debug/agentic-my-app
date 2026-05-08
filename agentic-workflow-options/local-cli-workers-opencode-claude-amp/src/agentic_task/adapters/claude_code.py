from __future__ import annotations

from .base import WorkerAdapter, WorkerInvocation, package_root


class ClaudeCodeAdapter(WorkerAdapter):
    id = "claude-code"

    def placeholder_command(self, inv: WorkerInvocation) -> list[str]:
        stub = package_root() / "bin" / "agentic-worker-claude"
        return [str(stub), "--print-from", str(inv.prompt_file)]


def planned_real_command(inv: WorkerInvocation) -> list[str]:
    """Shape from docs/plan.md §12 Claude Code (prompt as inline string in real use)."""
    text = inv.prompt_file.read_text(encoding="utf-8")
    return ["claude", "--print", text]
