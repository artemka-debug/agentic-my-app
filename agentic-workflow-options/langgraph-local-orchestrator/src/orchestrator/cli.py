"""Typer CLI — Phase 1 commands."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import typer

from orchestrator import __version__
from orchestrator.config import load_config, resolve_db_path
from orchestrator.db.models import RunRow, create_engine_and_session
from orchestrator.db.schema import init_db
from orchestrator.graph.build import build_graph
from orchestrator.store import insert_run, new_run_id, prepare_run_paths, record_event

app = typer.Typer(no_args_is_help=True, help="LangGraph local orchestrator (Phase 1 skeleton).")
run_app = typer.Typer(no_args_is_help=True, help="Run lifecycle commands.")
issue_app = typer.Typer(no_args_is_help=True, help="GitHub issue intake (stub).")
config_app = typer.Typer(no_args_is_help=True, help="Configuration.")
app.add_typer(run_app, name="run")
app.add_typer(issue_app, name="issue")
app.add_typer(config_app, name="config")


def _cwd() -> Path:
    return Path.cwd()


@app.callback()
def main_callback() -> None:
    """Entry point for the orchestrator CLI."""


@app.command("version")
def version_cmd() -> None:
    """Print package version."""
    typer.echo(__version__)


@config_app.command("validate")
def config_validate(
    config_path: Optional[Path] = typer.Option(
        None, "--config", "-c", help="Path to YAML config file."
    ),
) -> None:
    """Load and validate orchestrator.config.yaml (or built-in defaults)."""
    cfg = load_config(path=config_path, cwd=_cwd())
    typer.echo("Configuration is valid.")
    typer.echo(cfg.model_dump_json(indent=2))


@issue_app.command("start")
def issue_start(issue_ref: str = typer.Argument(..., help="OWNER/REPO#N or GitHub issue URL.")) -> None:
    """Start a run from a GitHub issue (Phase 2 — not implemented)."""
    typer.echo(f"Issue-based intake is not implemented yet (Phase 2). Reference: {issue_ref!r}")


task_app = typer.Typer(no_args_is_help=True, help="Manual task intake.")
app.add_typer(task_app, name="task")


@task_app.command("start")
def task_start(
    file: Optional[Path] = typer.Option(
        None, "--file", "-f", help="Markdown or text file describing the task."
    ),
    prompt: Optional[str] = typer.Option(None, "--prompt", "-p", help="Inline task description."),
    config_path: Optional[Path] = typer.Option(None, "--config", "-c"),
) -> None:
    """Start a manual task run (executes intake → PO → decomposition placeholders)."""
    if not file and not prompt:
        typer.echo("Provide --file or --prompt.", err=True)
        raise typer.Exit(2)
    if file and prompt:
        typer.echo("Use only one of --file or --prompt.", err=True)
        raise typer.Exit(2)

    cwd = _cwd()
    cfg = load_config(path=config_path, cwd=cwd)
    run_id = new_run_id()
    thread_id = run_id
    db_path, _art = prepare_run_paths(cfg, cwd, run_id)

    if file:
        text = file.read_text(encoding="utf-8")
        title = file.stem
        body = text
    else:
        title = "inline-task"
        body = prompt or ""

    engine, SessionFactory = create_engine_and_session(f"sqlite:///{db_path}")
    init_db(engine)
    graph = build_graph(db_path)

    initial: dict = {
        "run_id": run_id,
        "thread_id": thread_id,
        "source_kind": "manual",
        "task_title": title,
        "task_body": body,
    }

    with SessionFactory() as session:
        insert_run(session, run_id=run_id, thread_id=thread_id, workspace_root=cwd)
        record_event(session, run_id, "run_created", {"cwd": str(cwd)})
        session.commit()

    with SessionFactory() as session:
        row = session.get(RunRow, run_id)
        if row:
            row.current_node = "starting"
            session.commit()

    config = {"configurable": {"thread_id": thread_id}}
    try:
        out = graph.invoke(initial, config)
    except Exception as e:
        with SessionFactory() as session:
            record_event(session, run_id, "run_failed", {"error": str(e)})
            row = session.get(RunRow, run_id)
            if row:
                row.status = "failed"
            session.commit()
        typer.echo(f"Run failed: {e}", err=True)
        raise typer.Exit(1) from e

    with SessionFactory() as session:
        row = session.get(RunRow, run_id)
        if row:
            row.status = "completed"
            row.current_node = str(out.get("current_node", ""))
        record_event(session, run_id, "run_completed", {"current_node": out.get("current_node")})
        session.commit()

    typer.echo(json.dumps({"runId": run_id, "status": "completed", "output": out}, indent=2))


@run_app.command("status")
def run_status(run_id: str = typer.Argument(..., help="Run identifier, e.g. run_ab12cd34ef56.")) -> None:
    """Show persisted status for a run (read-only Phase 1 view)."""
    cwd = _cwd()
    cfg = load_config(cwd=cwd)
    db_path = resolve_db_path(cfg, cwd)
    if not db_path.is_file():
        typer.echo(f"No database at {db_path}.", err=True)
        raise typer.Exit(1)

    engine, SessionFactory = create_engine_and_session(f"sqlite:///{db_path}")
    init_db(engine)
    with SessionFactory() as session:
        row = session.get(RunRow, run_id)
        if not row:
            typer.echo(f"No run {run_id!r}.", err=True)
            raise typer.Exit(1)
        payload = {
            "runId": row.id,
            "status": row.status,
            "threadId": row.thread_id,
            "currentNode": row.current_node,
            "workspaceRoot": row.workspace_root,
            "note": "Full LangGraph checkpoint inspection coming in later phases.",
        }
        typer.echo(json.dumps(payload, indent=2))


@run_app.command("resume")
def run_resume(run_id: str = typer.Argument(..., help="Run to resume.")) -> None:
    """Resume a checkpointed run (stub — wired in Phase 12 / checkpointer integration)."""
    typer.echo(
        json.dumps(
            {
                "runId": run_id,
                "status": "stub",
                "message": "Resume will reload LangGraph checkpoint + run row in a later phase.",
            },
            indent=2,
        )
    )


@run_app.command("abort")
def run_abort(run_id: str = typer.Argument(..., help="Run to abort.")) -> None:
    """Abort a run (stub — cooperative cancellation TBD)."""
    typer.echo(
        json.dumps(
            {
                "runId": run_id,
                "status": "stub",
                "message": "Abort / cancellation policy not implemented in Phase 1 skeleton.",
            },
            indent=2,
        )
    )


def main() -> None:
    app()


if __name__ == "__main__":
    main()
