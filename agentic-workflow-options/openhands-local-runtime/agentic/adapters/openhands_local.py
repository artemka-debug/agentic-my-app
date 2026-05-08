from __future__ import annotations

"""OpenHands host-local runtime stub (elevated privileges / no container).

Allowed only under explicit selector + strict command policy (`command_policy`,
path allowlists/denylists, timeouts per docs/plan.md §4). Intended for trusted
hosts or Docker-less environments — default remains `openhands-docker`.
"""

from pathlib import Path
from typing import Any

from agentic.adapters.base import AdapterRunPreview, ensure_paths


class OpenHandsLocalAdapter:
    name = "openhands-local"

    def run_preview(
        self,
        *,
        worktree: Path,
        prompt_path: Path,
        extra: dict[str, Any] | None = None,
    ) -> AdapterRunPreview:
        ensure_paths(worktree, prompt_path)
        msg = (
            "openhands-local: executes on host — enforce policies before wiring; "
            "see README + scripts/agentic-worker-openhands-local-example.sh"
        )
        return AdapterRunPreview(
            engine=self.name,
            worktree=worktree,
            prompt_path=prompt_path,
            message=msg,
            hints={
                "warning": "Host execution can mutate outside the worktree unless sandboxed elsewhere.",
                "extra": extra or {},
            },
        )
