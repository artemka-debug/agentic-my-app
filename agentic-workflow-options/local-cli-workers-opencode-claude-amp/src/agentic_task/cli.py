from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from .adapters.amp import AmpAdapter
from .adapters.claude_code import ClaudeCodeAdapter
from .adapters.opencode import OpenCodeAdapter
from .adapters.base import WorkerInvocation
from .config import artifacts_dir, load_config, worktrees_root
from .intake import github, manual, spec
from .planning import (
    initial_state,
    render_plan_summary,
    stub_decomposition,
    stub_requirements,
)
from .runs import RunPaths, ensure_run_dir, new_run_id, read_yaml, write_yaml
from .worktree import worktree_create_stub


ENGINES = {
    "opencode": OpenCodeAdapter(),
    "claude": ClaudeCodeAdapter(),
    "claude-code": ClaudeCodeAdapter(),
    "amp": AmpAdapter(),
}


def _write_worker_prompt(
    run_paths: RunPaths,
    candidate_id: str,
    worktree: Path,
) -> Path:
    wdir = run_paths.root / "workers" / candidate_id
    wdir.mkdir(parents=True, exist_ok=True)
    p = wdir / "prompt.md"
    body = f"""# Worker prompt (stub)

Run: {run_paths.root.name}
Candidate: {candidate_id}
Worktree: {worktree}

Replace with full template from docs/plan.md §13.
"""
    p.write_text(body, encoding="utf-8")
    return p


def cmd_start_plan(args: argparse.Namespace) -> int:
    cfg = load_config()
    cwd = Path.cwd()
    ar = artifacts_dir(cfg, cwd)
    run_id = new_run_id()
    run_dir = ensure_run_dir(ar, run_id)
    paths = RunPaths(run_dir)

    plan_only = args.command == "plan"
    autonomy = "full" if getattr(args, "autonomy", None) == "full" else "normal"

    issue_ref = getattr(args, "issue", None)
    prompt = getattr(args, "prompt", None)
    spec_path = getattr(args, "spec", None)

    modes = sum(x is not None for x in (issue_ref, prompt, spec_path))
    if modes != 1:
        print("Exactly one of --issue, --prompt, or --spec is required.", file=sys.stderr)
        return 2

    if issue_ref:
        parsed = github.parse_issue_ref(issue_ref)
        gh_data = github.fetch_via_gh(parsed)
        intake = github.build_intake_yaml(parsed, gh_data)
        source_kind = "github_issue"
        paths.state.parent.mkdir(parents=True, exist_ok=True)
        state_extra = {
            "run": {
                "source": {
                    "type": "github_issue",
                    "url": intake.get("source", {}).get("url"),
                    "repo": intake.get("source", {}).get("repo"),
                    "issue_number": intake.get("source", {}).get("issue_number"),
                }
            }
        }
    elif prompt:
        intake = manual.build_intake_from_prompt(prompt)
        source_kind = "manual_prompt"
        state_extra = {"run": {"source": intake.get("source", {})}}
    else:
        sp = Path(spec_path).expanduser()
        if not sp.is_file():
            print(f"Spec not found: {sp}", file=sys.stderr)
            return 2
        intake = spec.build_intake_from_spec(sp)
        source_kind = "local_spec"
        state_extra = {"run": {"source": intake.get("source", {})}}

    write_yaml(paths.intake, intake)
    reqs = stub_requirements(intake)
    write_yaml(paths.requirements, reqs)
    dec = stub_decomposition(reqs)
    write_yaml(paths.decomposition, dec)

    state = initial_state(
        run_id=run_id,
        source_kind=source_kind,
        plan_only=plan_only,
        autonomy=autonomy,
        cfg=cfg,
    )
    state["run"].update(state_extra["run"])
    write_yaml(paths.state, state)

    print(f"Run initialized: {run_id}")
    print(f"Artifacts: {paths.root}")
    print()
    print(render_plan_summary(reqs, dec))
    if plan_only:
        print("\n(plan only — run status: planning)")
    elif autonomy == "full":
        print("\n(full autonomy — decomposition gate skipped in state)")
    else:
        print("\nNext: edit requirements/decomposition YAML, then `agentic-task approve --run " + run_id + "`")
    return 0


def cmd_approve(args: argparse.Namespace) -> int:
    cfg = load_config()
    cwd = Path.cwd()
    ar = artifacts_dir(cfg, cwd)
    run_dir = ar / args.run
    paths = RunPaths(run_dir)
    if not paths.state.is_file():
        print(f"No run state at {paths.state}", file=sys.stderr)
        return 2
    state = read_yaml(paths.state)

    now = (
        datetime.now(tz=timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )
    ap = state.get("approval") or {}
    ap["decomposition_approved"] = True
    ap["decomposition_approved_at"] = now
    state["approval"] = ap
    run = state.get("run") or {}
    run["status"] = "approved_for_worktrees"
    state["run"] = run
    write_yaml(paths.state, state)
    print(f"Approved decomposition for {args.run} at {now}")
    return 0


def cmd_worker_run(args: argparse.Namespace) -> int:
    engine = args.engine
    adapter = ENGINES.get(engine)
    if not adapter:
        print(f"Unknown engine {engine!r}. Try: opencode, claude, amp", file=sys.stderr)
        return 2
    cfg = load_config()
    cwd = Path.cwd()
    ar = artifacts_dir(cfg, cwd)
    run_paths = RunPaths(ar / args.run)
    if not run_paths.state.is_file():
        print(f"No run state at {run_paths.state}", file=sys.stderr)
        return 2

    worktree = Path(args.worktree).expanduser()
    prompt = _write_worker_prompt(run_paths, args.candidate_id, worktree)
    inv = WorkerInvocation(
        engine=engine,
        run_id=args.run,
        candidate_id=args.candidate_id,
        worktree=worktree,
        prompt_file=prompt,
        requirements_file=run_paths.requirements,
        decomposition_file=run_paths.decomposition,
    )
    argv = adapter.placeholder_command(inv)
    print("Placeholder worker invocation (Phase 3–4 stub):")
    print(" ", " ".join(argv))
    print("\nPlanned real CLI shape:", file=sys.stderr)
    return 0


def cmd_workers_spawn(args: argparse.Namespace) -> int:
    """Stub: print worktree paths; optional script hook."""
    cfg = load_config()
    cwd = Path.cwd()
    wr = worktrees_root(cfg, cwd)
    script = Path(__file__).resolve().parent.parent.parent / "scripts" / "worktree-create.sh"
    for i, eng in enumerate(["opencode", "claude", "amp"]):
        cid = f"{eng}-{args.run[-6:]}-{i:02d}"
        info = worktree_create_stub(
            run_id=args.run,
            candidate_id=cid,
            worktrees_root=wr,
            script=script if script.is_file() else None,
        )
        print(f"{eng}: {info['path']}")
    return 0


def cmd_resume(args: argparse.Namespace) -> int:
    cfg = load_config()
    cwd = Path.cwd()
    paths = RunPaths(artifacts_dir(cfg, cwd) / args.run)
    if not paths.state.is_file():
        print(f"No run state at {paths.state}", file=sys.stderr)
        return 2
    state = read_yaml(paths.state)
    reqs = read_yaml(paths.requirements) if paths.requirements.is_file() else {}
    dec = read_yaml(paths.decomposition) if paths.decomposition.is_file() else {}
    print(f"Resume: {args.run}")
    print(f"Status: {(state.get('run') or {}).get('status')}")
    print()
    print(render_plan_summary(reqs, dec))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="agentic-task", description="Local CLI harness skeleton.")
    sub = p.add_subparsers(dest="command", required=True)

    def intake_flags(sp: argparse.ArgumentParser) -> None:
        g = sp.add_mutually_exclusive_group(required=True)
        g.add_argument("--issue", help="owner/repo#NUM or GitHub issue URL")
        g.add_argument("--prompt", help="Manual task description")
        g.add_argument("--spec", help="Path to local markdown spec")

    sp_start = sub.add_parser("start", help="Create a new run from intake")
    intake_flags(sp_start)
    sp_start.add_argument(
        "--autonomy",
        choices=["full", "normal"],
        default="normal",
        help="full skips decomposition approval in state",
    )

    sp_plan = sub.add_parser("plan", help="Planning-only run (status stays planning)")
    intake_flags(sp_plan)

    sp_apr = sub.add_parser("approve", help="Approve decomposition for a run")
    sp_apr.add_argument("--run", required=True, help="Run id, e.g. run-2026-05-08-120000")

    sp_wr = sub.add_parser("worker", help="Worker commands")
    wr_sub = sp_wr.add_subparsers(dest="worker_cmd", required=True)
    sp_wrun = wr_sub.add_parser("run", help="Print stub worker command line (Phase 4)")
    sp_wrun.add_argument("--engine", required=True)
    sp_wrun.add_argument("--run-id", dest="run", required=True)
    sp_wrun.add_argument("--candidate-id", required=True)
    sp_wrun.add_argument("--worktree", required=True)

    sp_ws = sub.add_parser("workers", help="Spawn stub candidate paths")
    ws_sub = sp_ws.add_subparsers(dest="workers_cmd", required=True)
    sp_spawn = ws_sub.add_parser("spawn", help="Stub fanout worktree paths")
    sp_spawn.add_argument("--run", required=True)
    sp_spawn.add_argument("--fanout", default="balanced")

    sp_res = sub.add_parser("resume", help="Show run summary from artifacts")
    sp_res.add_argument("--run", required=True)

    return p


def main(argv: list[str] | None = None) -> None:
    argv = argv if argv is not None else sys.argv[1:]
    parser = build_parser()
    args = parser.parse_args(argv)

    handlers = {
        "start": cmd_start_plan,
        "plan": cmd_start_plan,
        "approve": cmd_approve,
        "worker": None,
        "workers": None,
        "resume": cmd_resume,
    }
    if args.command == "worker":
        if args.worker_cmd == "run":
            sys.exit(cmd_worker_run(args))
        parser.error("Unknown worker subcommand")
    if args.command == "workers":
        if args.workers_cmd == "spawn":
            sys.exit(cmd_workers_spawn(args))
        parser.error("Unknown workers subcommand")

    fn = handlers.get(args.command)
    if fn:
        sys.exit(fn(args))
    parser.error("Unknown command")


if __name__ == "__main__":
    main()
