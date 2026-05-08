from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ISSUE_REF = re.compile(
    r"^(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+)#(?P<num>\d+)$"
)
GITHUB_URL = re.compile(
    r"github\.com/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+)/issues/(?P<num>\d+)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class GitHubIssueRef:
    owner: str
    repo: str
    number: int

    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.repo}"

    def as_source_yaml_dict(self) -> dict[str, Any]:
        return {
            "type": "github_issue",
            "repo": self.full_name,
            "issue": self.number,
        }


def parse_github_issue_reference(ref: str) -> GitHubIssueRef:
    s = ref.strip()
    m = ISSUE_REF.match(s)
    if m:
        return GitHubIssueRef(m.group("owner"), m.group("repo"), int(m.group("num")))
    m = GITHUB_URL.search(s)
    if m:
        return GitHubIssueRef(m.group("owner"), m.group("repo"), int(m.group("num")))
    raise ValueError(
        "Expected owner/repo#123 or a github.com/.../issues/123 URL — got: "
        + repr(ref[:120])
    )


def gh_issue_json(ref: GitHubIssueRef, use_gh_cli: bool = True) -> dict[str, Any]:
    """Fetch issue metadata via GitHub CLI (`gh`). Requires `gh` in PATH and auth."""
    if not use_gh_cli:
        raise NotImplementedError("Only gh CLI intake is implemented in Phase 1 skeleton.")

    repo = ref.full_name
    num = str(ref.number)
    cmd = [
        "gh",
        "issue",
        "view",
        num,
        "--repo",
        repo,
        "--json",
        ",".join(
            [
                "title",
                "body",
                "state",
                "labels",
                "assignees",
                "author",
                "closed",
                "number",
                "url",
                "comments",
                "milestone",
            ]
        ),
    ]
    try:
        out = subprocess.check_output(cmd, text=True)
    except FileNotFoundError as e:
        raise RuntimeError("`gh` not found; install GitHub CLI or set PATH.") from e
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"gh issue view failed for {repo}#{num}: {e}") from e
    data = json.loads(out)
    return data


def stub_task_brief_from_ref(ref: GitHubIssueRef) -> dict[str, Any]:
    """Minimal brief when GitHub metadata is intentionally skipped (`--no-gh`)."""

    url = f"https://github.com/{ref.full_name}/issues/{ref.number}"
    return {
        "task_brief": {
            "source": ref.as_source_yaml_dict(),
            "problem": "",
            "user_goal": f"Issue #{ref.number} ({ref.full_name})",
            "known_constraints": {},
            "ambiguity": [
                "Issue body not fetched (--no-gh). Fill problem/user_goal manually or re-run without --no-gh."
            ],
            "repo_context_needed": [],
            "_intake_meta": {"url": url, "number": ref.number, "stub": True},
        }
    }


def build_task_brief_from_issue(ref: GitHubIssueRef, issue: dict[str, Any]) -> dict[str, Any]:
    """Structured TaskBrief-shaped document (docs/plan.md §8 Intake Agent)."""
    labels = issue.get("labels") or []
    label_names = [x.get("name") for x in labels if isinstance(x, dict) and x.get("name")]
    comments = issue.get("comments") or []

    ambiguity: list[str] = []
    if not (issue.get("body") or "").strip():
        ambiguity.append("Issue body empty — intent may need clarification.")

    return {
        "task_brief": {
            "source": ref.as_source_yaml_dict(),
            "problem": (issue.get("body") or "").strip(),
            "user_goal": (issue.get("title") or "").strip(),
            "known_constraints": {
                "labels": label_names,
                "milestone": (issue.get("milestone") or {}) if isinstance(issue.get("milestone"), dict) else issue.get("milestone"),
            },
            "ambiguity": ambiguity,
            "repo_context_needed": [
                "Populate from repository docs/README per project conventions.",
            ],
            "_intake_meta": {
                "url": issue.get("url"),
                "number": issue.get("number"),
                "state": issue.get("state"),
                "comments_count": len(comments) if isinstance(comments, list) else 0,
                "comments": comments,
            },
        }
    }


def write_yaml(path: Path, data: dict[str, Any]) -> None:
    import yaml

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)


def write_placeholder_requirements(run_dir: Path) -> Path:
    """Skeleton requirements_spec for PO phase; Cursor/PO agent fills content."""
    data = {
        "requirements_spec": {
            "requirement_ids": [
                {"id": "REQ-001", "text": "<replace with testable requirement>"},
            ],
            "acceptance_criteria": [],
            "edge_cases": [],
            "constraints": [],
            "definition_of_done": [],
        },
        "_note": "Replace placeholders after PO clarification — see docs/plan.md §8.",
    }
    p = run_dir / "requirements.yaml"
    write_yaml(p, data)
    return p


def write_placeholder_decomposition(run_dir: Path) -> Path:
    data = {
        "implementation_plan": {
            "tasks": [
                {
                    "id": "TASK-001",
                    "objective": "<implementation objective>",
                    "requirements": ["REQ-001"],
                    "suggested_areas": [],
                    "tests": [],
                    "dependencies": [],
                }
            ]
        },
        "_note": "Flesh out after requirements_spec is stable.",
    }
    p = run_dir / "decomposition.yaml"
    write_yaml(p, data)
    return p
