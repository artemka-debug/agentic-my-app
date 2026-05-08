#!/usr/bin/env bash
# Phase 3 stub — replace with `git worktree add` using base branch from run state.
set -euo pipefail
RUN_ID="${1:?run id}"
CANDIDATE_ID="${2:?candidate id}"
WORKTREES_ROOT="${3:?worktrees root}"
echo "[agentic-task stub] worktree-create: run=${RUN_ID} candidate=${CANDIDATE_ID} root=${WORKTREES_ROOT}"
mkdir -p "${WORKTREES_ROOT}/${RUN_ID}/candidate-${CANDIDATE_ID}"
echo "[agentic-task stub] created directory placeholder (no git worktree yet)"
