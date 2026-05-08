#!/usr/bin/env bash
# Example wrapper: OpenHands + Docker worker (see docs/plan.md §17).
# Usage:
#   export WORKTREE=/path/to/.worktrees/issue-123-candidate-a
#   export PROMPT=/path/to/.agentic/runs/RUN_ID/candidates/a/prompt.md
#   ./scripts/agentic-worker-openhands-docker-example.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
if [[ -z "${WORKTREE:-}" || -z "${PROMPT:-}" ]]; then
  echo "Set WORKTREE and PROMPT to the candidate worktree and prompt.md" >&2
  exit 1
fi
if command -v agentic >/dev/null 2>&1; then
  exec agentic worker run --engine openhands-docker --worktree "${WORKTREE}" --prompt "${PROMPT}" "$@"
fi
export PYTHONPATH="${ROOT}${PYTHONPATH:+:${PYTHONPATH}}"
exec python -m agentic worker run --engine openhands-docker --worktree "${WORKTREE}" --prompt "${PROMPT}" "$@"
