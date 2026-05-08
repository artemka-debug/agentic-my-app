from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from typing import Any

# owner/repo#123 or https://github.com/owner/repo/issues/123
ISSUE_REF = re.compile(
    r"^(?:(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+)#(?P<num>\d+)|"
    r"https?://github\.com/(?P<owner2>[A-Za-z0-9_.-]+)/(?P<repo2>[A-Za-z0-9_.-]+)/issues/(?P<num2>\d+)/?)$"
)


@dataclass
class ParsedIssue:
    owner: str
    repo: str
    number: int

    @property
    def slug(self) -> str:
        return f"{self.owner}/{self.repo}"

    @property
    def url(self) -> str:
        return f"https://github.com/{self.owner}/{self.repo}/issues/{self.number}"


def parse_issue_ref(ref: str) -> ParsedIssue:
    ref = ref.strip()
    m = ISSUE_REF.match(ref)
    if not m:
        raise ValueError(
            "Expected owner/repo#123 or https://github.com/owner/repo/issues/123"
        )
    if m.group("owner"):
        return ParsedIssue(m.group("owner"), m.group("repo"), int(m.group("num")))
    return ParsedIssue(
        m.group("owner2"), m.group("repo2"), int(m.group("num2"))
    )


def fetch_via_gh(parsed: ParsedIssue) -> dict[str, Any] | None:
    """Return gh JSON payload if `gh` is available and authenticated; else None."""
    repo = f"{parsed.owner}/{parsed.repo}"
    cmd = [
        "gh",
        "issue",
        "view",
        str(parsed.number),
        "--repo",
        repo,
        "--json",
        "title,body,labels,url,author,state",
    ]
    try:
        out = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        return None


def build_intake_yaml(parsed: ParsedIssue, gh_data: dict[str, Any] | None) -> dict[str, Any]:
    labels: list[str] = []
    if gh_data and isinstance(gh_data.get("labels"), list):
        for lab in gh_data["labels"]:
            if isinstance(lab, dict) and "name" in lab:
                labels.append(str(lab["name"]))
            elif isinstance(lab, str):
                labels.append(lab)

    body = ""
    title = ""
    if gh_data:
        title = str(gh_data.get("title") or "")
        body = str(gh_data.get("body") or "")

    summary = title or f"Issue #{parsed.number} in {parsed.slug}"
    quote = body or "(issue body not fetched — run with `gh` authenticated or paste content manually)"

    return {
        "source": {
            "type": "github_issue",
            "repo": parsed.slug,
            "issue_number": parsed.number,
            "url": gh_data.get("url") if gh_data else parsed.url,
        },
        "summary": summary,
        "labels": labels,
        "stakeholders": {},
        "source_fragments": [
            {
                "id": "SRC-001",
                "kind": "issue_body",
                "quote": quote,
            },
        ],
        "fetch": {
            "method": "gh_cli" if gh_data else "placeholder",
            "note": "Populate labels/comments via PO agent or re-run with `gh` installed.",
        },
    }
