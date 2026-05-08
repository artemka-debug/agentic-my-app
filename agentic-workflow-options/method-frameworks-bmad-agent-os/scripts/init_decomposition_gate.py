#!/usr/bin/env python3
"""Initialize decomposition + approval artifacts for a run (planning gate).

Copies templates into `.agentic/runs/<run>/` without overwriting existing files.

Usage:
  python3 scripts/init_decomposition_gate.py --run-dir .agentic/runs/<run-id>
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _package_root() -> Path:
    return Path(__file__).resolve().parent.parent


(src: Path, dest: Path) -> bool:
    if dest.exists():
        return False
    dest.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Create decomposition + approval templates for a run")
    parser.add_argument("--run-dir", type=Path, required=True, help="Path to .agentic/runs/<id>")
    args = parser.parse_args()

    root = _package_root()
    run_dir = args.run_dir.resolve()
    if not run_dir.is_dir():
        raise SystemExit(f"run directory not found: {run_dir}")

    tpl_dec = root / "templates" / "run" / "decomposition.template.json"
    tpl_apr = root / "templates" / "run" / "approval.template.json"
    written = 0
    if copy_if_missing(tpl_dec, run_dir / "decomposition.json"):
        written += 1
    if copy_if_missing(tpl_apr, run_dir / "approval.json"):
        written += 1

    merge_run_envelope(run_dir, {"planning_gate": "decomposition_pending"})

    if written == 0:
        print("No files written (decomposition.json / approval.json already exist).")
    else:
        print(f"Wrote {written} file(s) to {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
