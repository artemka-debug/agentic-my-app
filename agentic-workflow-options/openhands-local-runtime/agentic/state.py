from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import yaml

# States must match state-machine.yaml and docs/plan.md §14.
VALID_STATES = frozenset(
    {
        "intake",
        "clarifying",
        "specified",
        "decomposed",
        "awaiting_approval",
        "implementing",
        "verifying",
        "retrying",
        "finalizing",
        "pr_opened",
        "monitoring_pr",
        "complete",
        "failed",
        "cancelled",
    }
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass
class RunState:
    run_id: str
    state: str
    updated_at: str = field(default_factory=utc_now_iso)
    source: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    history: list[dict[str, str]] = field(default_factory=list)

    def validate(self) -> None:
        if self.state not in VALID_STATES:
            raise ValueError(f"Invalid state {self.state!r}; expected one of {sorted(VALID_STATES)}")

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "state": self.state,
            "updated_at": self.updated_at,
            "source": self.source,
            "notes": self.notes,
            "history": self.history,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RunState:
        return cls(
            run_id=str(data["run_id"]),
            state=str(data["state"]),
            updated_at=str(data.get("updated_at") or utc_now_iso()),
            source=dict(data.get("source") or {}),
            notes=list(data.get("notes") or []),
            history=list(data.get("history") or []),
        )

    def transition(self, new_state: str, reason: str = "") -> None:
        if new_state not in VALID_STATES:
            raise ValueError(f"Invalid transition target {new_state!r}")
        self.history.append(
            {
                "from": self.state,
                "to": new_state,
                "at": utc_now_iso(),
                "reason": reason,
            }
        )
        self.state = new_state
        self.updated_at = utc_now_iso()


def load_state(path: Path) -> RunState:
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    rs = RunState.from_dict(data)
    rs.validate()
    return rs


def save_state(path: Path, state: RunState) -> None:
    state.validate()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(state.to_dict(), f, sort_keys=False, allow_unicode=True)
