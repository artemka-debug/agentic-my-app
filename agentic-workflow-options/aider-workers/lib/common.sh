#!/usr/bin/env bash
# Shared helpers for local-orchestrator (Phases 1–3).

set -euo pipefail

orc_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ORC_HOME="$orc_root"
export ORC_TEMPLATES="$orc_root/templates"
export ORC_LIB="$orc_root/lib"

die() {
  printf 'local-orchestrator: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

# Default paths under current working directory (target repo root).
orc_dot_dir=".orchestrator"
orc_runs_dir="${orc_dot_dir}/runs"

utc_ts() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

append_event() {
  local run_dir="$1"
  local stage="$2"
  local event="$3"
  local details_json="${4:-"{}"}"
  local ts
  ts="$(utc_ts)"
  local run_id
  run_id="$(basename "$run_dir")"
  printf '{"timestamp":"%s","runId":"%s","stage":"%s","event":"%s","details":%s}\n' \
    "$ts" "$run_id" "$stage" "$event" "$details_json" >>"${run_dir}/events.jsonl"
}

mkdir_p_run() {
  local run_dir="$1"
  mkdir -p "${run_dir}/candidates"
  mkdir -p "${run_dir}/final"
  mkdir -p "${run_dir}/pr-monitor"
  mkdir -p "${run_dir}/prompts"
}

ensure_run_dir_writable() {
  local repo_root="$1"
  mkdir -p "${repo_root}/${orc_dot_dir}/worktrees"
}
