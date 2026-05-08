"""State machine definition loader and run state transitions."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass
class StateMachineSpec:
    version: int
    initial_state: str
    states: dict[str, dict[str, Any]]
    transitions: list[dict[str, str]]

    @classmethod
    def load(cls, path: Path) -> StateMachineSpec:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return cls(
            version=int(payload["version"]),
            initial_state=str(payload["initial_state"]),
            states=dict(payload["states"]),
            transitions=list(payload["transitions"]),
        )

    def allowed_transition(self, current: str, event: str) -> str | None:
        for t in self.transitions:
            if t["from"] == current and t["event"] == event:
                return str(t["to"])
        return None


def default_machine_path() -> Path:
    return Path(__file__).resolve().parent / "schemas" / "state-machine.json"


@dataclass
class RunState:
    """Persisted to `.agentic-runs/<run-id>/state.json`."""

    run_id: str
    workflow_state: str
    updated_at: str = field(default_factory=_utc_now_iso)
    message: str | None = None
    intake: dict[str, Any] = field(default_factory=dict)

    def touch(self, workflow_state: str | None = None, message: str | None = None) -> None:
        self.updated_at = _utc_now_iso()
        if workflow_state is not None:
            self.workflow_state = workflow_state
        if message is not None:
            self.message = message

    def to_json_obj(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_json_obj(cls, obj: Mapping[str, Any]) -> RunState:
        return cls(
            run_id=str(obj["run_id"]),
            workflow_state=str(obj["workflow_state"]),
            updated_at=str(obj.get("updated_at") or _utc_now_iso()),
            message=obj.get("message"),
            intake=dict(obj.get("intake") or {}),
        )


def load_run_state(path: Path) -> RunState:
    obj = json.loads(path.read_text(encoding="utf-8"))
    return RunState.from_json_obj(obj)


def save_run_state(path: Path, state: RunState) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state.to_json_obj(), indent=2) + "\n", encoding="utf-8")


def transition(
    machine: StateMachineSpec,
    state: RunState,
    event: str,
    *,
    message: str | None = None,
) -> RunState:
    nxt = machine.allowed_transition(state.workflow_state, event)
    if nxt is None:
        raise ValueError(
            f"No transition for event {event!r} from state {state.workflow_state!r}"
        )
    state.workflow_state = nxt
    state.touch(message=message)
    return state


def new_run_state(run_id: str, machine: StateMachineSpec) -> RunState:
    return RunState(run_id=run_id, workflow_state=machine.initial_state)
