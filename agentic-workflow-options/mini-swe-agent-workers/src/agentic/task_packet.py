"""Normalized task packet (Phase 2) — stable JSON for downstream agents."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def build_manual_packet(
    *,
    task_id: str,
    text: str,
    linked_issue_url: str | None = None,
    extra_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    pkt: dict[str, Any] = {
        "version": 1,
        "source": "manual",
        "task_id": task_id,
        "summary": text.strip().splitlines()[0][:500] if text.strip() else "(empty)",
        "created_at": utc_now_iso(),
        "manual": {"text": text, "linked_issue_url": linked_issue_url},
        "metadata": dict(extra_metadata or {}),
    }
    return pkt


def build_github_packet(
    *,
    task_id: str,
    owner: str,
    repo: str,
    issue_payload: dict[str, Any],
    comments: list[dict[str, Any]],
    linked_pull_requests: list[dict[str, Any]],
    repo_meta: dict[str, Any],
    extra_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    title = issue_payload.get("title") or ""
    web_url = (
        issue_payload.get("html_url")
        or issue_payload.get("htmlUrl")
        or issue_payload.get("url")
        or ""
    )
    pkt: dict[str, Any] = {
        "version": 1,
        "source": "github_issue",
        "task_id": task_id,
        "summary": str(title)[:500],
        "created_at": utc_now_iso(),
        "github": {
            "owner": owner,
            "repo": repo,
            "number": int(issue_payload.get("number")),
            "html_url": web_url,
            "title": title,
            "body": issue_payload.get("body"),
            "state": issue_payload.get("state"),
            "labels": issue_payload.get("labels") or [],
            "assignees": issue_payload.get("assignees") or [],
            "milestone": issue_payload.get("milestone"),
            "comments": comments,
            "linked_pull_requests": linked_pull_requests,
            "repository": repo_meta,
        },
        "metadata": dict(extra_metadata or {}),
    }
    return pkt
