#!/usr/bin/env bash
# Example wrapper: OpenHands host-local worker (strict policy required per docs/plan.md §4).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
if [[ -z "${WORKTREE:-}" || -z "${PROMPT:-}" ]]; then
  echo "Set WORKTREE and PROMPT to the candidate worktree and prompt.md" >&2
  exit 1
fi
if command -v agentic >/dev/null 2>&1; then
  exec agentic worker run --engine openhands-local --worktree "${WORKTREE}" --prompt "${PROMPT}" "$@"
fi
export PYTHONPATH="${ROOT}${PYTHONPATH:+:${PYTHONPATH}}"
exec python -m agentic worker run --engine openhands-local --worktree "${WORKTREE}" --prompt "${PROMPT}" "$@"
