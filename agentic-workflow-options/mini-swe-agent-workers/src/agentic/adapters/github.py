"""Aggregate GitHub issue intake into a normalized packet."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from agentic import github_intake as gh
from agentic.task_packet import build_github_packet


def ingest_github_issue(
    spec: str,
    *,
    default_repo: str | None,
    log_file: Path | None = None,
) -> dict[str, Any]:
    owner, repo, num = gh.parse_issue_reference(spec, default_repo=default_repo)
    auth = gh.check_github_auth(log_file=log_file)
    repo_meta = gh.fetch_repository_meta(owner, repo, log_file=log_file)
    issue = gh.fetch_issue_core(owner, repo, num, log_file=log_file)
    comments = gh.fetch_issue_comments(owner, repo, num, log_file=log_file)
    linked = gh.fetch_linked_pull_requests(owner, repo, num, log_file=log_file)
    task_id = f"github-issue-{owner}-{repo}-{num}"
    pkt = build_github_packet(
        task_id=task_id,
        owner=owner,
        repo=repo,
        issue_payload=issue,
        comments=comments,
        linked_pull_requests=linked,
        repo_meta=repo_meta,
        extra_metadata={"intake_tool": "gh", "github_auth": auth},
    )
    return pkt


def dump_packet(path: Path, packet: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(packet, indent=2) + "\n", encoding="utf-8")
