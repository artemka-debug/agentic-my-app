from __future__ import annotations

"""Cursor-local implementation engine stub.

Uses the Cursor IDE agent to edit the assigned git worktree. The orchestrator
(Cursor harness) owns prompts and lifecycle; this adapter is a contractual
placeholder for spawning or hand-off to Cursor-driven tasks.

Prefer driving work through Cursor Composer/Agent tasks referencing `prompt.md`;
this module documents expected inputs/outputs for a future programmatic hook.
"""

from pathlib import Path
from typing import Any

from agentic.adapters.base import AdapterRunPreview, ensure_paths


class CursorLocalAdapter:
    name = "cursor-local"

    def run_preview(
        self,
        *,
        worktree: Path,
        prompt_path: Path,
        extra: dict[str, Any] | None = None,
    ) -> AdapterRunPreview:
        ensure_paths(worktree, prompt_path)
        msg = (
            "cursor-local: orchestrator delegates to Cursor harness; "
            "open Cursor with this worktree and attach prompt file."
        )
        return AdapterRunPreview(
            engine=self.name,
            worktree=worktree,
            prompt_path=prompt_path,
            message=msg,
            hints={
                "see": "README.md Phase 2 / scripts/agentic-worker-cursor-local-example.sh",
                "extra": extra or {},
            },
        )
