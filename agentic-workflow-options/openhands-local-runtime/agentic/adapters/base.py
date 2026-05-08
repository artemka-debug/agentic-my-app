from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, runtime_checkable


@dataclass
class AdapterRunPreview:
    """Placeholder result until transcript/patch capture lands (Phase 2+).

    Hooks for future fields: transcript_path, patch_path, exit_code, logs.
    """

    engine: str
    worktree: Path
    prompt_path: Path
    message: str
    hints: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class RuntimeAdapter(Protocol):
    """Unified interface for `cursor-local`, `openhands-docker`, `openhands-local`.

    Responsibilities per docs/plan.md:
    workspace mount/bind, env injection, command timeout, test execution,
    artifact + transcript capture, retry context.
    """

    name: str

    def run_preview(
        self,
        *,
        worktree: Path,
        prompt_path: Path,
        extra: dict[str, Any] | None = None,
    ) -> AdapterRunPreview:
        """Dry-run stub: validates paths and echoes intent (no subprocess)."""


def ensure_paths(worktree: Path, prompt_path: Path) -> None:
    if not worktree.exists():
        raise FileNotFoundError(f"Worktree missing: {worktree}")
    if not prompt_path.is_file():
        raise FileNotFoundError(f"Prompt file missing: {prompt_path}")
