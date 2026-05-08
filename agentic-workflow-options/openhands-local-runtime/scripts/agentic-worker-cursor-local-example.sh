#!/usr/bin/env bash
# Example wrapper: Cursor-local harness hand-off (orchestrator stays in Cursor).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
if [[ -z "${WORKTREE:-}" || -z "${PROMPT:-}" ]]; then
  echo "Set WORKTREE and PROMPT; then open Cursor on WORKTREE with PROMPT attached." >&2
  exit 1
fi
if command -v agentic >/dev/null 2>&1; then
  exec agentic worker run --engine cursor-local --worktree "${WORKTREE}" --prompt "${PROMPT}" "$@"
fi
export PYTHONPATH="${ROOT}${PYTHONPATH:+:${PYTHONPATH}}"
exec python -m agentic worker run --engine cursor-local --worktree "${WORKTREE}" --prompt "${PROMPT}" "$@"
