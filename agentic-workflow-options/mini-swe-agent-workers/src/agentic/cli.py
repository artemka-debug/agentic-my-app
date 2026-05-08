"""Orchestrator CLI (Phases 1–2)."""

from __future__ import annotations

import argparse
import json
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

from agentic.adapters import github as github_adapter
from agentic.adapters import manual as manual_adapter
from agentic.config import LOCAL_CONFIG_DIR, AgenticConfig
from agentic.git_utils import create_worktree, git_top_level, resolve_default_branch
from agentic.paths import (
    candidate_worktree,
    ensure_run_layout,
    orchestrator_log_path,
    state_path,
    task_packet_path,
)
from agentic.state import (
    StateMachineSpec,
    default_machine_path,
    load_run_state,
    new_run_state,
    save_run_state,
    transition,
)
from agentic.subprocess_runner import check_gh_available


def _run_id() -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"run-{ts}-{secrets.token_hex(3)}"


def _ensure_machine() -> StateMachineSpec:
    return StateMachineSpec.load(default_machine_path())


def cmd_init(args: argparse.Namespace) -> int:
    root = Path(args.repo_root).resolve() if args.repo_root else Path.cwd()
    dot = root / LOCAL_CONFIG_DIR
    dot.mkdir(parents=True, exist_ok=True)
    cfg_path = dot / "agentic.yaml"
    example = Path(__file__).resolve().parents[2] / "agentic.yaml.example"
    if cfg_path.exists():
        print(f"Config already exists: {cfg_path}")
        return 0
    if example.is_file():
        cfg_path.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
    else:
        cfg_path.write_text(
            "# See agentic.yaml.example in this package for a full template.\n",
            encoding="utf-8",
        )
    print(f"Wrote {cfg_path}")
    return 0


def cmd_issue_intake(args: argparse.Namespace) -> int:
    repo_root = git_top_level(Path(args.repo_root) if args.repo_root else None)
    cfg = AgenticConfig.load(path=Path(args.config) if args.config else None, repo_root=repo_root)
    machine = _ensure_machine()
    log_path = None  # set after run_id
    run_id = args.run_id or _run_id()
    ensure_run_layout(repo_root, run_id)
    log_path = orchestrator_log_path(repo_root, run_id)

    state = new_run_state(run_id, machine)
    save_run_state(state_path(repo_root, run_id), state)

    try:
        transition(machine, state, "start_intake", message="intake began")
        save_run_state(state_path(repo_root, run_id), state)

        if args.manual is not None:
            pkt = manual_adapter.manual_task_packet(
                args.manual,
                linked_issue_url=args.issue_link,
            )
            state.intake = {"mode": "manual", "task_id": pkt["task_id"]}
        else:
            if not args.issue:
                raise SystemExit("Provide an issue reference or --manual TEXT.")
            check_gh_available(log_file=log_path)
            pkt = github_adapter.ingest_github_issue(
                args.issue,
                default_repo=cfg.github_source.default_repo,
                log_file=log_path,
            )
            owner = pkt["github"]["owner"]
            repo = pkt["github"]["repo"]
            num = pkt["github"]["number"]
            state.intake = {
                "mode": "github",
                "owner": owner,
                "repo": repo,
                "number": num,
                "task_id": pkt["task_id"],
            }

        github_adapter.dump_packet(task_packet_path(repo_root, run_id), pkt)
        transition(machine, state, "intake_succeeded", message="task packet written")
        save_run_state(state_path(repo_root, run_id), state)
        print(f"Run ID: {run_id}")
        print(f"State: {state.workflow_state}")
        print(f"Task packet: {task_packet_path(repo_root, run_id)}")
        print(f"Log: {log_path}")
        return 0
    except Exception as exc:  # noqa: BLE001 — CLI boundary
        try:
            transition(machine, state, "intake_failed", message=str(exc))
        except ValueError:
            state.workflow_state = "failed"
            state.touch(message=str(exc))
        save_run_state(state_path(repo_root, run_id), state)
        if log_path:
            log_path.open("a", encoding="utf-8").write(f"\n[intake error] {exc}\n")
        print(f"error: {exc}", file=sys.stderr)
        return 1


def cmd_status(args: argparse.Namespace) -> int:
    repo_root = git_top_level(Path(args.repo_root) if args.repo_root else None)
    run_id = args.run_id
    st_path = state_path(repo_root, run_id)
    if not st_path.is_file():
        print(f"No state at {st_path}", file=sys.stderr)
        return 1
    state = load_run_state(st_path)
    pkt_path = task_packet_path(repo_root, run_id)
    summary_lines = [
        "## Agentic run status",
        "",
        f"- **run_id**: `{state.run_id}`",
        f"- **workflow_state**: `{state.workflow_state}`",
        f"- **updated_at**: `{state.updated_at}`",
    ]
    if state.message:
        summary_lines.append(f"- **message**: {state.message}")
    if state.intake:
        summary_lines.append(f"- **intake**: `{json.dumps(state.intake)}`")
    summary_lines.extend(
        [
            "",
            "### Paths",
            "",
            f"- state: `{st_path}`",
            f"- task packet: `{pkt_path}` ({'present' if pkt_path.is_file() else 'missing'})",
            f"- orchestrator log: `{orchestrator_log_path(repo_root, run_id)}`",
            f"- worktrees: `{candidate_worktree(repo_root, run_id, '<candidate>')}`",
            "",
        ]
    )
    print("\n".join(summary_lines))
    return 0


def cmd_worktree_add(args: argparse.Namespace) -> int:
    repo_root = git_top_level(Path(args.repo_root) if args.repo_root else None)
    run_id = args.run_id
    cand = args.candidate_id
    st_path = state_path(repo_root, run_id)
    if not st_path.is_file():
        print(f"No run state at {st_path}", file=sys.stderr)
        return 1
    ensure_run_layout(repo_root, run_id)
    dest = candidate_worktree(repo_root, run_id, cand)
    log_path = orchestrator_log_path(repo_root, run_id)
    base = args.base
    if not base:
        branch = resolve_default_branch(repo_root, log_file=log_path)
        base = f"origin/{branch}"
    create_worktree(repo_root, path=dest, branch_or_commit=base, log_file=log_path)
    print(f"Worktree ready at {dest} (base {base})")
    return 0


def cmd_machine_dump(args: argparse.Namespace) -> int:
    machine = _ensure_machine()
    print(json.dumps({"initial_state": machine.initial_state, "states": machine.states}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="agentic", description="Local agentic orchestrator (mini-SWE workers).")
    p.add_argument("--version", action="version", version="agentic 0.1.0")
    sub = p.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init", help="Create .agentic/agentic.yaml from the example template.")
    p_init.add_argument("--repo-root", type=str, default=None, help="Git repo root (default: cwd).")
    p_init.set_defaults(func=cmd_init)

    p_in = sub.add_parser("issue", help="Issue/task intake commands.")
    in_sub = p_in.add_subparsers(dest="issue_cmd", required=True)
    p_intake = in_sub.add_parser("intake", help="Fetch GitHub issue via gh or accept a manual task.")
    p_intake.add_argument("issue", nargs="?", default=None, help="owner/repo#N, issue URL, or #N with default_repo.")
    p_intake.add_argument("--manual", type=str, default=None, help="Manual task text (skips GitHub).")
    p_intake.add_argument("--issue-link", type=str, default=None, help="Optional GitHub issue URL for manual tasks.")
    p_intake.add_argument("--repo-root", type=str, default=None)
    p_intake.add_argument("--config", type=str, default=None, help="Explicit agentic.yaml path.")
    p_intake.add_argument(
        "--run-id",
        type=str,
        default=None,
        help="Fixed run id folder name (default: auto-generated).",
    )
    p_intake.set_defaults(func=cmd_issue_intake)

    p_status = sub.add_parser("status", help="Print Cursor-friendly Markdown summary for a run.")
    p_status.add_argument("run_id")
    p_status.add_argument("--repo-root", type=str, default=None)
    p_status.set_defaults(func=cmd_status)

    p_wt = sub.add_parser("worktree", help="Git worktree helpers under .agentic-runs.")
    wt_sub = p_wt.add_subparsers(dest="wt_cmd", required=True)
    p_add = wt_sub.add_parser("add", help="Create a detached candidate worktree at the run worktrees path.")
    p_add.add_argument("run_id")
    p_add.add_argument("candidate_id")
    p_add.add_argument("--base", type=str, default=None, help="Branch or SHA (default: origin/<default>).")
    p_add.add_argument("--repo-root", type=str, default=None)
    p_add.set_defaults(func=cmd_worktree_add)

    p_sm = sub.add_parser("machine-dump", help="Print bundled state machine metadata (debug).")
    p_sm.set_defaults(func=cmd_machine_dump)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))
