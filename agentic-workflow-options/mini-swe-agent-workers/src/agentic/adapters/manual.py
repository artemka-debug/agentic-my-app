"""Manual task source adapter (baseline for future multi-source intake)."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any

from agentic.task_packet import build_manual_packet


def manual_task_packet(text: str, *, linked_issue_url: str | None = None) -> dict[str, Any]:
    """Create a normalized packet from free-form task text."""
    suffix = secrets.token_hex(3)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    task_id = f"manual-{ts}-{suffix}"
    return build_manual_packet(task_id=task_id, text=text, linked_issue_url=linked_issue_url)
