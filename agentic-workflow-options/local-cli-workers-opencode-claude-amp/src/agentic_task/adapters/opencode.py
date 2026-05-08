from __future__ import annotations

from .base import WorkerAdapter, WorkerInvocation, package_root


class OpenCodeAdapter(WorkerAdapter):
    id = "opencode"

    def placeholder_command(self, inv: WorkerInvocation) -> list[str]:
        stub = package_root() / "bin" / "agentic-worker-opencode"
        return [str(stub), "run", "--prompt-file", str(inv.prompt_file)]


def planned_real_command(inv: WorkerInvocation) -> list[str]:
    """Shape from docs/plan.md §12 OpenCode."""
    return ["opencode", "run", "--prompt-file", str(inv.prompt_file)]
