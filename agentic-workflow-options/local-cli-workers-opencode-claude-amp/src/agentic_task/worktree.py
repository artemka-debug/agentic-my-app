from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

# Phase 3: real worktree lifecycle will call git worktree add/remove.


def worktree_create_stub(
    *,
    run_id: str,
    candidate_id: str,
    worktrees_root: Path,
    script: Path | None = None,
) -> dict[str, Any]:
    """Invoke optional shell stub or return planned paths only."""
    worktree_path = worktrees_root / run_id / f"candidate-{candidate_id}"
    if script and script.is_file():
        subprocess.run(
            [str(script), run_id, candidate_id, str(worktrees_root)],
            check=False,
        )
    return {"run_id": run_id, "candidate_id": candidate_id, "path": str(worktree_path)}
