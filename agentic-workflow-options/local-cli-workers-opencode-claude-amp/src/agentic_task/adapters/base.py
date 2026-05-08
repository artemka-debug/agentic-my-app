from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def package_root() -> Path:
    """Project root containing `config/`, `bin/`, `schemas/`."""
    return Path(__file__).resolve().parent.parent.parent.parent


@dataclass
class WorkerInvocation:
    engine: str
    run_id: str
    candidate_id: str
    worktree: Path
    prompt_file: Path
    requirements_file: Path
    decomposition_file: Path


class WorkerAdapter(ABC):
    id: str

    @abstractmethod
    def placeholder_command(self, inv: WorkerInvocation) -> list[str]:
        """Return argv to invoke real CLI when implemented."""
