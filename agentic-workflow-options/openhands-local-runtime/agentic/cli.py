from __future__ import annotations

import argparse
import sys
from pathlib import Path

from agentic.github_intake import parse_github_issue_reference
from agentic.paths import agentic_dir, bundled_config_template, orchestrator_root
from agentic.run_layout import create_run_structure, default_project_root, find_run_dir
from agentic.state import load_state, save_state


def _cmd_issue_start(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve() if args.root else default_project_root()
    ref = args.ref
    try:
        gh = parse_github_issue_reference(ref)
    except ValueError:
        # Free-form task text / non-GitHub ref
        run = create_run_structure(root, freeform_hint=ref, use_gh=False)
        print(run)
        return 0
    run = create_run_structure(root, github_ref=gh, use_gh=not args.no_gh)
    print(run)
    return 0


def _cmd_spec_approve(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve() if args.root else default_project_root()
    run_dir = find_run_dir(root, args.run_id)
    req = run_dir / "requirements.yaml"
    dec = run_dir / "decomposition.yaml"
    if not req.is_file() or not dec.is_file():
        print("Missing requirements.yaml or decomposition.yaml", file=sys.stderr)
        return 1
    st = load_state(run_dir / "state.yaml")
    if st.state not in {"clarifying", "specified", "decomposed"}:
        print(f"Refusing spec approve from state {st.state!r}", file=sys.stderr)
        return 1
    st.transition("specified", "Human approved requirements shape (skeleton gate)")
    st.transition("decomposed", "Decomposition acknowledged for this run")
    st.transition("awaiting_approval", "Awaiting implementation approval (or use --autonomous on run)")
    save_state(run_dir / "state.yaml", st)
    print(run_dir / "state.yaml")
    return 0


def _cmd_run(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve() if args.root else default_project_root()
    run_dir = find_run_dir(root, args.run_id)
    st = load_state(run_dir / "state.yaml")
    autonomous = getattr(args, "autonomous", False)
    allowed = {"awaiting_approval"}
    if autonomous:
        allowed |= {"clarifying", "specified", "decomposed"}
    if st.state not in allowed:
        print(
            f"Run not allowed from state {st.state!r}; "
            "use `agentic spec approve` or `--autonomous` (from clarifying onward).",
            file=sys.stderr,
        )
        return 1
    reason = "autonomous override" if autonomous else "Approved for implementation"
    st.transition("implementing", reason)
    save_state(run_dir / "state.yaml", st)
    print("Skeleton: hook runtime adapter here → see agentic.adapters")
    print(run_dir)
    return 0


def _cmd_verify(_args: argparse.Namespace) -> int:
    print("Stub: verification pipeline not implemented yet (Phase 4).")
    return 0


def _cmd_finalize(args: argparse.Namespace) -> int:
    print(
        "Stub: finalize / PR creation not implemented yet (Phase 5). flags:",
        getattr(args, "create_pr", False),
    )
    return 0


def _cmd_pr_monitor(_args: argparse.Namespace) -> int:
    print("Stub: PR monitor not implemented yet (Phase 6).")
    return 0


def _cmd_status(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve() if args.root else default_project_root()
    run_dir = find_run_dir(root, args.run_id)
    st = load_state(run_dir / "state.yaml")
    print(f"RUN_ID={st.run_id}\nSTATE={st.state}\nUPDATED_AT={st.updated_at}\nSOURCE={st.source}")
    return 0


def _cmd_logs(args: argparse.Namespace) -> int:
    c = getattr(args, "candidate", "") or "(all)"
    print(f"Stub: logs aggregator not implemented yet. candidate filter={c}")
    return 0


def _cmd_worker_run(args: argparse.Namespace) -> int:
    """Dispatch to Phase 2 adapter modules (callable from wrapper scripts)."""
    from agentic.adapters import get_adapter

    engine = args.engine
    adapter = get_adapter(engine)
    worktree = Path(args.worktree).resolve()
    prompt = Path(args.prompt).resolve()
    result = adapter.run_preview(worktree=worktree, prompt_path=prompt, extra=vars(args))
    print(result)
    return 0


def _cmd_init_config(_args: argparse.Namespace) -> int:
    root = default_project_root()
    d = agentic_dir(root)
    d.mkdir(parents=True, exist_ok=True)
    src = bundled_config_template()
    if not src.is_file():
        src = orchestrator_root() / ".agentic" / "config.template.yaml"
    dest = d / "config.yaml"
    if dest.exists():
        print(f"Already exists: {dest}", file=sys.stderr)
        return 1
    dest.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    print(dest)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="agentic", description="Local agentic orchestrator (skeleton).")
    p.add_argument("--root", help="Repository root (default: cwd or AGENTIC_REPO_ROOT).")

    sub = p.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init-config", help="Copy bundled config template to .agentic/config.yaml")
    p_init.set_defaults(func=_cmd_init_config)

    p_is = sub.add_parser("issue", help="GitHub issue intake")
    ist = p_is.add_subparsers(dest="issue_cmd", required=True)
    p_start = ist.add_parser("start", help="Start a run from owner/repo#N, issue URL, or free-form text.")
    p_start.add_argument("ref", help="owner/repo#123, GitHub issue URL, or free-form description")
    p_start.add_argument("--no-gh", action="store_true", help="Do not invoke gh CLI (for URLs still parse repo# only)")
    p_start.set_defaults(func=_cmd_issue_start)

    p_sa = sub.add_parser("spec", help="Requirements / decomposition gates")
    sps = p_sa.add_subparsers(dest="spec_cmd", required=True)
    p_apr = sps.add_parser("approve", help="Mark placeholders approved and move to awaiting_approval.")
    p_apr.add_argument("run_id")
    p_apr.set_defaults(func=_cmd_spec_approve)

    p_run = sub.add_parser("run", help="Begin implementation phase (skeleton)")
    p_run.add_argument("run_id")
    p_run.add_argument("--autonomous", action="store_true")
    p_run.set_defaults(func=_cmd_run)

    p_ver = sub.add_parser("verify", help="Run verifier pipeline")
    p_ver.add_argument("run_id")
    p_ver.set_defaults(func=_cmd_verify)

    p_fin = sub.add_parser("finalize", help="Finalize and optionally open PR")
    p_fin.add_argument("run_id")
    p_fin.add_argument("--create-pr", action="store_true")
    p_fin.set_defaults(func=_cmd_finalize)

    p_pm = sub.add_parser("pr", help="PR lifecycle helpers")
    pms = p_pm.add_subparsers(dest="pr_cmd", required=True)
    p_mon = pms.add_parser("monitor", help="Poll CI/reviews")
    p_mon.add_argument("run_id")
    p_mon.set_defaults(func=_cmd_pr_monitor)

    p_st = sub.add_parser("status", help="Show run state")
    p_st.add_argument("run_id")
    p_st.set_defaults(func=_cmd_status)

    p_lg = sub.add_parser("logs", help="Show logs for run / candidate")
    p_lg.add_argument("run_id")
    p_lg.add_argument("--candidate", default="")
    p_lg.set_defaults(func=_cmd_logs)

    p_wk = sub.add_parser("worker", help="Low-level adapter runner")
    wks = p_wk.add_subparsers(dest="worker_cmd", required=True)
    p_wr = wks.add_parser("run", help="Run configured engine stub against a worktree + prompt")
    p_wr.add_argument("--engine", required=True, choices=["cursor-local", "openhands-docker", "openhands-local"])
    p_wr.add_argument("--worktree", required=True)
    p_wr.add_argument("--prompt", required=True)
    p_wr.set_defaults(func=_cmd_worker_run)

    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    raise SystemExit(args.func(args))
