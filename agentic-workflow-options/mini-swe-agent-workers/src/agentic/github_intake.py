"""GitHub intake via `gh` CLI (Phase 2)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from agentic.subprocess_runner import run_logged


_ISSUE_URL = re.compile(
    r"^https?://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/issues/(?P<num>\d+)/?$",
    re.I,
)
_REF = re.compile(r"^(?P<owner>[^/]+)/(?P<repo>[^/]+)#(?P<num>\d+)$")


def parse_issue_reference(
    spec: str,
    *,
    default_repo: str | None,
) -> tuple[str, str, int]:
    """
    Accept owner/repo#N, GitHub issue URL, or #N with default_repo owner/repo.
    """
    s = spec.strip()
    m = _REF.match(s)
    if m:
        return m.group("owner"), m.group("repo"), int(m.group("num"))
    m = _ISSUE_URL.match(s)
    if m:
        return m.group("owner"), m.group("repo"), int(m.group("num"))
    if s.startswith("#") and default_repo:
        num = int(s[1:])
        o, r = default_repo.split("/", maxsplit=1)
        return o, r, num
    raise ValueError(
        f"Unrecognized issue reference: {spec!r}. "
        "Use owner/repo#123, a github.com issue URL, or #123 with sources.github.default_repo."
    )


def gh_json(argv: list[str], *, cwd: Path | None = None, log_file: Path | None = None) -> Any:
    r = run_logged(argv, cwd=cwd, log_file=log_file, timeout_seconds=120)
    if r.returncode != 0:
        raise RuntimeError(f"gh command failed ({argv}): {r.stderr.strip()}")
    return json.loads(r.stdout or "null")


def check_github_auth(*, log_file: Path | None = None) -> dict[str, Any]:
    """
    Verify `gh` is logged in; return parsed auth fields when available.
    Token scopes are printed by `gh auth status -t` (best-effort parse).
    """
    run_logged(["gh", "auth", "status"], log_file=log_file, timeout_seconds=30)
    scopes: list[str] = []
    r = run_logged(["gh", "auth", "status", "-t"], log_file=log_file, timeout_seconds=30)
    # Typical line: "Token scopes: 'gist', 'read:org', 'repo'"
    for line in (r.stdout or "").splitlines():
        line_l = line.strip().lower()
        if line_l.startswith("token scopes:"):
            rest = line.split(":", 1)[1].strip().strip("'\"")
            scopes = [x.strip().strip("'\"") for x in rest.split(",") if x.strip()]
    return {"logged_in": True, "token_scopes": scopes}


def fetch_repository_meta(owner: str, repo: str, *, log_file: Path | None = None) -> dict[str, Any]:
    data = gh_json(
        ["gh", "repo", "view", f"{owner}/{repo}", "--json", "nameWithOwner,description,defaultBranchRef"],
        log_file=log_file,
    )
    dbr = data.get("defaultBranchRef") or {}
    branch_name = (dbr.get("name") if isinstance(dbr, dict) else None) or ""
    return {
        "full_name": data.get("nameWithOwner"),
        "default_branch": branch_name,
        "description": data.get("description"),
    }


def fetch_issue_core(owner: str, repo: str, number: int, *, log_file: Path | None = None) -> dict[str, Any]:
    spec = f"{owner}/{repo}"
    return gh_json(
        [
            "gh",
            "issue",
            "view",
            str(number),
            "--repo",
            spec,
            "--json",
            "title,body,state,labels,assignees,milestone,number,url,author,createdAt,updatedAt",
        ],
        log_file=log_file,
    )


def fetch_issue_comments(owner: str, repo: str, number: int, *, log_file: Path | None = None) -> list[dict[str, Any]]:
    api_path = f"/repos/{owner}/{repo}/issues/{number}/comments"
    raw = gh_json(["gh", "api", api_path, "--paginate"], log_file=log_file)
    return raw if isinstance(raw, list) else []


def fetch_linked_pull_requests(
    owner: str,
    repo: str,
    number: int,
    *,
    log_file: Path | None = None,
) -> list[dict[str, Any]]:
    """Best-effort linked PRs via issue timeline cross-reference events."""
    api_path = f"/repos/{owner}/{repo}/issues/{number}/timeline"
    argv = [
        "gh",
        "api",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        "X-GitHub-Api-Version: 2022-11-28",
        api_path,
        "--paginate",
    ]
    r = run_logged(argv, log_file=log_file, timeout_seconds=120)
    if r.returncode != 0:
        return []
    events = json.loads(r.stdout or "[]")
    if not isinstance(events, list):
        return []
    linked: list[dict[str, Any]] = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        if ev.get("event") != "cross-referenced":
            continue
        src = ev.get("source") or {}
        if not isinstance(src, dict):
            continue
        pr = src.get("pull_request") or src.get("PullRequest")
        if isinstance(pr, dict):
            linked.append(pr)
    return linked


def validate_github_issue_url(url: str) -> tuple[str, str, int]:
    return parse_issue_reference(url, default_repo=None)
