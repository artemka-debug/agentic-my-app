#!/usr/bin/env python3
"""GitHub issue intake using the local GitHub CLI (`gh`).

Writes `.agentic/runs/<run-id>/intake.json` under --agentic-root (default: current directory).
Requires `gh` to be installed, authenticated, and able to read the target repository.

Usage:
  python3 scripts/github_intake.py owner/repo 42 --agentic-root /path/to/repo
  python3 scripts/github_intake.py https://github.com/owner/repo/issues/42
  python3 scripts/github_intake.py --plain-text "Local task" --agentic-root .
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def _run_gh_json(args: list[str]) -> Any:
    cmd = ["gh", *args]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"`{' '.join(cmd)}` failed (exit {proc.returncode}):\n{proc.stderr or proc.stdout}"
        )
    return json.loads(proc.stdout or "null")


def _run_gh_api_paginated(path: str) -> list[dict[str, Any]]:
    """GET a GitHub REST path via gh api, following pagination Link headers."""
    items: list[dict[str, Any]] = []
    # gh api automatically concatenates paginated JSON arrays for many endpoints when using --paginate
    proc = subprocess.run(
        ["gh", "api", "--paginate", path],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        return items
    # Paginated output can be multiple JSON arrays concatenated; gh joins them in some versions.
    raw = proc.stdout.strip()
    if not raw:
        return items
    try:
        decoded = json.loads(raw)
        if isinstance(decoded, list):
            return [x for x in decoded if isinstance(x, dict)]
    except json.JSONDecodeError:
        pass
    # Fallback: line-delimited array chunks (older gh)
    for part in raw.split("\n"):
        part = part.strip()
        if not part:
            continue
        try:
            chunk = json.loads(part)
            if isinstance(chunk, list):
                items.extend(c for c in chunk if isinstance(c, dict))
        except json.JSONDecodeError:
            continue
    return items


def _parse_github_issue_url(url: str) -> tuple[str, int] | None:
    parsed = urlparse(url.strip())
    if parsed.netloc not in {"github.com", "www.github.com"} or not parsed.path:
        return None
    m = re.match(r"^/([^/]+)/([^/]+)/issues/(\d+)/?$", parsed.path)
    if not m:
        return None
    return f"{m.group(1)}/{m.group(2)}", int(m.group(3))


def _parse_repo_issue_arg(text: str) -> tuple[str | None, int | None]:
    t = text.strip()
    url_match = _parse_github_issue_url(t)
    if url_match:
        return url_match[0], url_match[1]
    m = re.match(r"^([^/]+/[^/#]+)#(\d+)$", t)
    if m:
        return m.group(1), int(m.group(2))
    if t.isdigit():
        return None, int(t)
    return None, None


def _slugify(text: str, max_len: int = 48) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", text.lower()).strip("-")
    s = re.sub(r"-{2,}", "-", s)
    return (s[:max_len].rstrip("-")) or "issue"


def _collect_linked_refs(
    owner: str, repo: str, issue_number: int
) -> list[dict[str, Any]]:
    """Use issue timeline events when available."""
    path = f"repos/{owner}/{repo}/issues/{issue_number}/timeline"
    events = _run_gh_api_paginated(path)
    refs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ev in events:
        et = ev.get("event")
        if et in {"connected", "cross-referenced", "referenced"}:
            src = ev.get("source") or {}
            if isinstance(src, dict):
                url = src.get("url") or src.get("issue", {}).get("url")
                if isinstance(url, str) and url not in seen:
                    seen.add(url)
                    refs.append({"kind": et, "url": url})
    return refs


def _heuristic_risk(issue: dict[str, Any]) -> str:
    blob = f"{issue.get('title', '')}\n{issue.get('body', '')}".lower()
    labels = [str(l.get("name", "")).lower() for l in issue.get("labels", [])]
    if any("security" in l or "auth" in l or "priority/critical" in l for l in labels):
        return "high"
    if any(k in blob for k in ("security", "csrf", "xss", "injection", "rce", "auth", "password")):
        return "high"
    if any("good first issue" in l for l in labels) or "docs" in labels:
        return "low"
    return "medium"


def _workflow_depth(risk: str, body_len: int) -> str:
    if risk == "high" or body_len > 2500:
        return "full"
    if risk == "low" and body_len < 400:
        return "quick"
    return "standard"


def _ambiguities(title: str, body: str) -> list[str]:
    text = f"{title}\n{body}"
    flags: list[str] = []
    if "?" in title or text.count("?") >= 3:
        flags.append("multiple_open_questions")
    if re.search(r"\b(tbd|todo|FIXME|unsure|need clarification)\b", text, re.I):
        flags.append("explicit_unknowns_in_text")
    return flags


def build_intake_plain(text: str) -> dict[str, Any]:
    return {
        "source": "plain_text",
        "repository": None,
        "issue_number": None,
        "title": text.strip().split("\n", 1)[0][:200] or "Local task",
        "body": text.strip(),
        "labels": [],
        "assignees": [],
        "milestone": None,
        "comments": [],
        "linked_pull_requests": [],
        "linked_references": [],
        "initial_risk": "medium",
        "ambiguities": _ambiguities(text[:200], text),
        "suggested_workflow_depth": _workflow_depth("medium", len(text)),
    }


def build_intake_github(owner: str, repo: str, issue_number: int) -> dict[str, Any]:
    repo_slash = f"{owner}/{repo}"
    fields = ",".join(
        [
            "title",
            "body",
            "labels",
            "assignees",
            "milestone",
            "comments",
            "number",
            "url",
            "state",
            "createdAt",
            "updatedAt",
        ]
    )
    issue = _run_gh_json(["issue", "view", str(issue_number), "--repo", repo_slash, "--json", fields])
    if not isinstance(issue, dict):
        raise RuntimeError("Unexpected gh JSON for issue view")

    linked_prs: list[dict[str, Any]] = []
    pr_search = _run_gh_json(
        [
            "pr",
            "list",
            "--repo",
            repo_slash,
            "--search",
            f"fixes #{issue_number} OR closes #{issue_number} OR resolves #{issue_number}",
            "--state",
            "all",
            "--json",
            "number,title,url,state",
        ]
    )
    if isinstance(pr_search, list):
        linked_prs = pr_search

    linked_refs = _collect_linked_refs(owner, repo, issue_number)

    risk = _heuristic_risk(issue)
    body = issue.get("body") or ""
    depth = _workflow_depth(risk, len(body))

    comments_raw = issue.get("comments") or []
    comments_out: list[dict[str, Any]] = []
    if isinstance(comments_raw, list):
        for c in comments_raw:
            if not isinstance(c, dict):
                continue
            author = c.get("author") or {}
            comments_out.append(
                {
                    "author": author.get("login") if isinstance(author, dict) else None,
                    "body": c.get("body"),
                    "created_at": c.get("createdAt"),
                }
            )

    milestone = issue.get("milestone")
    ms_out = None
    if isinstance(milestone, dict):
        ms_out = {"title": milestone.get("title"), "description": milestone.get("description")}

    assignees = []
    for a in issue.get("assignees") or []:
        if isinstance(a, dict) and a.get("login"):
            assignees.append(a["login"])

    labels = []
    for lab in issue.get("labels") or []:
        if isinstance(lab, dict) and lab.get("name"):
            labels.append(lab["name"])

    return {
        "source": "github",
        "repository": repo_slash,
        "issue_number": issue_number,
        "title": issue.get("title"),
        "body": body,
        "labels": labels,
        "assignees": assignees,
        "milestone": ms_out,
        "comments": comments_out,
        "linked_pull_requests": linked_prs,
        "linked_references": linked_refs,
        "initial_risk": risk,
        "ambiguities": _ambiguities(str(issue.get("title") or ""), body),
        "suggested_workflow_depth": depth,
        "github_url": issue.get("url"),
    }


def ensure_run_tree(run_dir: Path) -> None:
    (run_dir / "candidates").mkdir(parents=True, exist_ok=True)
    (run_dir / "final").mkdir(parents=True, exist_ok=True)


def write_intake(agentic_root: Path, payload: dict[str, Any], run_id: str | None) -> Path:
    agentic = agentic_root / ".agentic"
    rid = run_id or f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{_slugify(str(payload.get('title') or 'run'))}-{uuid.uuid4().hex[:6]}"
    run_dir = agentic / "runs" / rid
    ensure_run_tree(run_dir)
    intake_path = run_dir / "intake.json"
    envelope = {
        "run_id": rid,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    intake_path.write_text(json.dumps(envelope, indent=2) + "\n", encoding="utf-8")
    (agentic / "templates" / "prompts").mkdir(parents=True, exist_ok=True)
    (agentic / "templates" / "reports").mkdir(parents=True, exist_ok=True)
    return intake_path


def main() -> int:
    parser = argparse.ArgumentParser(description="GitHub issue intake via gh CLI")
    parser.add_argument(
        "issue",
        nargs="?",
        help="Issue reference: URL, owner/repo#123, or number (with --repo)",
    )
    parser.add_argument(
        "--repo",
        dest="repo",
        help="owner/repo when passing a bare issue number",
    )
    parser.add_argument(
        "--agentic-root",
        type=Path,
        default=Path.cwd(),
        help="Directory containing or that will contain .agentic (default: cwd)",
    )
    parser.add_argument(
        "--run-id",
        help="Optional run directory name under .agentic/runs/",
    )
    parser.add_argument(
        "--plain-text",
        dest="plain_text",
        help="Skip GitHub; write a plain-text intake payload",
    )
    args = parser.parse_args()

    try:
        if args.plain_text is not None:
            payload = build_intake_plain(args.plain_text)
            path = write_intake(args.agentic_root.resolve(), payload, args.run_id)
            print(str(path))
            return 0

        if not args.issue:
            parser.error("issue reference required unless --plain-text is set")

        owner_repo, num = _parse_repo_issue_arg(args.issue)
        if num is None:
            parser.error("Could not parse issue number from argument")
        if owner_repo is None:
            if not args.repo:
                parser.error("owner/repo required (embed in URL, use owner/repo#n, or pass --repo)")
            owner_repo = args.repo.strip()
        owner, _, repo = owner_repo.partition("/")
        if not owner or not repo:
            parser.error(f"Invalid repo '{owner_repo}', expected owner/repo")

        payload = build_intake_github(owner, repo, num)
        path = write_intake(args.agentic_root.resolve(), payload, args.run_id)
        print(str(path))
        return 0
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
