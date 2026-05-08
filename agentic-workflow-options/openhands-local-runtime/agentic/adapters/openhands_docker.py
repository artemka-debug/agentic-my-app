from __future__ import annotations

"""OpenHands + Docker runtime adapter stub (preferred default isolation).

Runs OpenHands CLI/headless with the candidate worktree mounted read-write at the
configured `workspace_mount` (default `/workspace` per `.agentic/config.yaml`).

Per docs/plan.md §4 Docker runtime: isolate CPU/memory/network mounts; persist
logs/patches outside containers. Production implementation should invoke the
wrapper at `scripts/agentic-worker-openhands-docker-example.sh`.
"""

from pathlib import Path
from typing import Any

from agentic.adapters.base import AdapterRunPreview, ensure_paths


class OpenHandsDockerAdapter:
    name = "openhands-docker"

    def run_preview(
        self,
        *,
        worktree: Path,
        prompt_path: Path,
        extra: dict[str, Any] | None = None,
    ) -> AdapterRunPreview:
        ensure_paths(worktree, prompt_path)
        msg = (
            "openhands-docker: invoke OpenHands CLI with isolated container; "
            "see README + scripts/agentic-worker-openhands-docker-example.sh"
        )
        return AdapterRunPreview(
            engine=self.name,
            worktree=worktree,
            prompt_path=prompt_path,
            message=msg,
            hints={
                "example_command": (
                    'docker run --rm -v "$WORKTREE:/workspace:rw" local/agent-runtime:latest '
                    "... # plus OpenHands invocation flags"
                ),
                "extra": extra or {},
            },
        )
