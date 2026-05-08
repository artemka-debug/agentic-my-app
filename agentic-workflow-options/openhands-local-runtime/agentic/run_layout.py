from __future__ import annotations

import os
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

import yaml

from agentic.github_intake import (
    GitHubIssueRef,
    build_task_brief_from_issue,
    gh_issue_json,
    parse_github_issue_reference,
    stub_task_brief_from_ref,
    write_placeholder_decomposition,
    write_placeholder_requirements,
    write_yaml,
)
from agentic.paths import agentic_dir, bundled_config_template, orchestrator_root, repo_root, runs_dir
from agentic.state import RunState, save_state


def sanitize_run_component(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", name).strip("-") or "run"


def new_run_id() -> str:
    return f"RUN-{uuid.uuid4().hex[:12]}"


def ensure_config_template_deployed(project_root: Path) -> Path:
    bundled = bundled_config_template()
    if not bundled.exists():
        bundled = orchestrator_root() / ".agentic" / "config.template.yaml"
    dest = agentic_dir(project_root) / "config.template.yaml"
    agentic_dir(project_root).mkdir(parents=True, exist_ok=True)
    if bundled.exists() and not dest.exists():
        shutil.copyfile(bundled, dest)
    return dest


def load_project_config(project_root: Path) -> dict[str, Any]:
    cfg = agentic_dir(project_root) / "config.yaml"
    if not cfg.exists():
        return {}
    with cfg.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def create_run_structure(
    project_root: Path,
    *,
    github_ref: GitHubIssueRef | None = None,
    freeform_hint: str | None = None,
    use_gh: bool = True,
) -> Path:
    ensure_config_template_deployed(project_root)
    cfg = load_project_config(project_root)
    gh_cfg = cfg.get("github") or {}
    use_gh_cli = bool(gh_cfg.get("use_gh_cli", True))

    rid = new_run_id()
    run_root = runs_dir(project_root) / rid
    run_root.mkdir(parents=True, exist_ok=False)
    (run_root / "candidates").mkdir(parents=True, exist_ok=True)
    (run_root / "final").mkdir(parents=True, exist_ok=True)

    if github_ref is not None:
        if use_gh and use_gh_cli:
            issue_payload = gh_issue_json(github_ref, use_gh_cli=True)
            brief = build_task_brief_from_issue(github_ref, issue_payload)
        else:
            brief = stub_task_brief_from_ref(github_ref)
    else:
        brief = {
            "task_brief": {
                "source": {"type": "freeform", "hint": freeform_hint or ""},
                "problem": freeform_hint or "",
                "user_goal": "",
                "known_constraints": {},
                "ambiguity": ["No GitHub issue linked at intake — clarify goal and scope."],
                "repo_context_needed": [],
            }
        }

    write_yaml(run_root / "task-brief.yaml", brief)

    write_placeholder_requirements(run_root)
    write_placeholder_decomposition(run_root)

    source_for_state: dict[str, Any]
    tb = brief.get("task_brief") or {}
    src = tb.get("source") or {}
    if src.get("type") == "github_issue":
        source_for_state = {
            "type": "github_issue",
            "repo": src.get("repo"),
            "issue": src.get("issue"),
        }
    else:
        source_for_state = dict(src)

    rs = RunState(run_id=rid, state="intake", source=source_for_state)
    rs.transition("clarifying", "Issue normalized; fill requirements.yaml / decomposition.yaml (PO phase)")
    save_state(run_root / "state.yaml", rs)

    worktrees_stub = {
        "run_id": rid,
        "base_branch": os.environ.get("AGENTIC_BASE_BRANCH", "<set-base-branch>"),
        "worktrees": [],
    }
    write_yaml(run_root / "worktrees.yaml", worktrees_stub)

    return run_root


def find_run_dir(project_root: Path, run_id: str) -> Path:
    p = runs_dir(project_root) / run_id
    if p.is_dir():
        return p
    raise FileNotFoundError(f"Unknown RUN_ID {run_id!r} under {runs_dir(project_root)}")


def default_project_root() -> Path:
    return repo_root()
