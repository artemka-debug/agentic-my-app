from __future__ import annotations

from .base import WorkerAdapter, WorkerInvocation, package_root


class AmpAdapter(WorkerAdapter):
    id = "amp"

    def placeholder_command(self, inv: WorkerInvocation) -> list[str]:
        stub = package_root() / "bin" / "agentic-worker-amp"
        return [str(stub), "-x-from", str(inv.prompt_file)]


def planned_real_command(inv: WorkerInvocation) -> list[str]:
    """Shape from docs/plan.md §12 Amp."""
    text = inv.prompt_file.read_text(encoding="utf-8")
    return ["amp", "-x", text]
