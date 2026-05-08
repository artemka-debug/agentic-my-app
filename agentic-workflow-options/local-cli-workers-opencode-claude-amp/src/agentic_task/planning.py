from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def stub_requirements(intake: dict[str, Any]) -> dict[str, Any]:
    """Skeleton PO output — replace via Cursor Product Owner agent."""
    summary = intake.get("summary", "Untitled task")
    src_fragments = intake.get("source_fragments") or []
    source_refs = [f.get("id") for f in src_fragments if isinstance(f, dict) and f.get("id")]
    if not source_refs:
        source_refs = ["SRC-001"]

    return {
        "_schema_stub": "schemas/requirements.schema.yaml",
        "summary": summary,
        "source": intake.get("source"),
        "labels": intake.get("labels", []),
        "stakeholders": intake.get("stakeholders", {}),
        "source_fragments": src_fragments,
        "open_questions": [
            "Replace this stub with PO clarifications and stable requirement IDs.",
        ],
        "requirements": [
            {
                "id": "REQ-001",
                "priority": "must",
                "source_refs": source_refs,
                "statement": "Implement the user-visible outcome described in the intake summary and source fragments.",
                "acceptance": [
                    {
                        "id": "AC-001",
                        "statement": "Acceptance criteria are written and testable for REQ-001.",
                    },
                ],
                "verification": [{"type": "manual_review"}],
            },
        ],
    }


def stub_decomposition(requirements: dict[str, Any]) -> dict[str, Any]:
    """Skeleton decomposition — replace via Cursor Decomposition agent."""
    return {
        "_schema_stub": "schemas/decomposition.schema.yaml",
        "notes": "Replace with task DAG, risk tags, and worker fanout strategy.",
        "tasks": [
            {
                "id": "TASK-001",
                "title": "Initial implementation pass from approved requirements",
                "requirement_refs": ["REQ-001"],
                "depends_on": [],
                "risk": "medium",
                "suggested_workers": [
                    "opencode-default",
                    "claude-code-premium",
                    "amp-diversity",
                ],
                "expected_files": [],
                "verification": ["unit", "integration"],
            },
        ],
    }


def initial_state(
    *,
    run_id: str,
    source_kind: str,
    plan_only: bool,
    autonomy: str,
    cfg: dict[str, Any],
) -> dict[str, Any]:
    h = cfg.get("harness") or {}
    ap = cfg.get("approval") or {}
    gh = cfg.get("github") or {}

    after_dec = ap.get("after_decomposition", "required")
    approval_mode = h.get("approval_mode", "approved_autonomy")
    if autonomy == "full":
        approval_mode = "full_autonomy"
        after_dec = "skip"

    now = (
        datetime.now(tz=timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )

    if plan_only:
        status = "planning"
        dec_approved = False
        dec_at: str | None = None
    elif autonomy == "full":
        status = "approved_plan_autonomy"
        dec_approved = True
        dec_at = now
    else:
        status = "awaiting_decomposition_approval"
        dec_approved = False
        dec_at = None

    return {
        "run": {
            "id": run_id,
            "status": status,
            "source": {"type": source_kind},
            "base_branch": gh.get("default_base_branch", "main"),
            "pr_branch": None,
            "approval_mode": approval_mode,
            "created_at": now,
        },
        "approval": {
            "after_decomposition": after_dec,
            "decomposition_approved": dec_approved,
            "decomposition_approved_at": dec_at,
        },
        "config_snapshot": {
            "artifacts_directory": (cfg.get("artifacts") or {}).get("directory"),
            "default_worker": (cfg.get("workers") or {}).get("default_engine"),
        },
    }


def render_plan_summary(
    requirements: dict[str, Any], decomposition: dict[str, Any]
) -> str:
    lines = [
        "=== Requirements (stub) ===",
        f"Summary: {requirements.get('summary', '')}",
        f"Open questions: {len(requirements.get('open_questions') or [])}",
        f"Requirements: {len(requirements.get('requirements') or [])}",
        "",
        "=== Decomposition (stub) ===",
        f"Tasks: {len(decomposition.get('tasks') or [])}",
    ]
    for t in decomposition.get("tasks") or []:
        if isinstance(t, dict):
            lines.append(f"  - {t.get('id')}: {t.get('title')}")
    return "\n".join(lines)
