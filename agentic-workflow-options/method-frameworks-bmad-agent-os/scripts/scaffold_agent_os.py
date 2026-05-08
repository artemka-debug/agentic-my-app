#!/usr/bin/env python3
"""Create Agent OS-style directories under agent-os/ (or custom root).

Usage:
  python3 scripts/scaffold_agent_os.py --root . --slug 2026-05-08-issue-42-feature
"""
from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    p = argparse.ArgumentParser(description="Scaffold agent-os/ standards, product, and specs tree.")
    p.add_argument("--root", type=Path, default=Path("."), help="Repository root")
    p.add_argument(
        "--slug",
        required=True,
        help="Spec folder name, e.g. 2026-05-08-issue-42-short-title",
    )
    args = p.parse_args()
    root: Path = args.root.resolve()
    slug: str = args.slug.strip().replace(" ", "-")

    base = root / "agent-os"
    spec = base / "specs" / slug
    paths = [
        base / "standards" / ".gitkeep",
        base / "product" / ".gitkeep",
        spec / "planning" / "requirements.md",
        spec / "spec.md",
        spec / "tasks.md",
    ]
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.suffix == ".md" and not path.exists():
            path.write_text(
                f"# {path.name.replace('.md', '').replace('-', ' ').title()}\n\n"
                f"<!-- Populated by PO / spec / decomposition agents. Issue spec: `{slug}` -->\n",
                encoding="utf-8",
            )
        elif path.name == ".gitkeep" and not path.exists():
            path.write_text("", encoding="utf-8")

    print(f"Scaffolded agent-os under {base} (spec: {spec})")


if __name__ == "__main__":
    main()
