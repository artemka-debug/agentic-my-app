from __future__ import annotations

"""Runtime adapters: local implementation engines invoked by the orchestrator.

See docs/plan.md §3 Agent Runtime Adapter, §17 worker commands, Phase 2 rollout."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

_CURSOR = "cursor-local"
_DOCKER = "openhands-docker"
_LOCAL = "openhands-local"


def get_adapter(engine: str):
    """Return stub adapter callable for `--engine`."""

    if engine == _CURSOR:
        from agentic.adapters import cursor_local

        return cursor_local.CursorLocalAdapter()

    if engine == _DOCKER:
        from agentic.adapters import openhands_docker

        return openhands_docker.OpenHandsDockerAdapter()

    if engine == _LOCAL:
        from agentic.adapters import openhands_local

        return openhands_local.OpenHandsLocalAdapter()

    raise ValueError(f"Unknown engine {engine!r}; expected {_CURSOR}, {_DOCKER}, {_LOCAL}")
