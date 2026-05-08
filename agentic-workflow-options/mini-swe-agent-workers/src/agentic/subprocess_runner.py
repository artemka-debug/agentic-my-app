"""Local command execution with timeout and log capture."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


def run_logged(
    argv: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    timeout_seconds: float | None = None,
    log_file: Path | None = None,
) -> CommandResult:
    """Run a command; optionally append merged transcript to log_file."""
    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        header = f"$ {' '.join(argv)}\n"
        log_file.open("a", encoding="utf-8").write(header)

    proc = subprocess.run(
        argv,
        cwd=str(cwd) if cwd else None,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
    )
    out = proc.stdout or ""
    err = proc.stderr or ""
    if log_file:
        with log_file.open("a", encoding="utf-8") as fh:
            if out:
                fh.write(out)
                if not out.endswith("\n"):
                    fh.write("\n")
            if err:
                fh.write(err)
                if not err.endswith("\n"):
                    fh.write("\n")
            fh.write(f"\n--- exit {proc.returncode} ---\n\n")
    return CommandResult(returncode=proc.returncode, stdout=out, stderr=err)


def check_gh_available(log_file: Path | None = None) -> None:
    r = run_logged(["gh", "--version"], log_file=log_file, timeout_seconds=10)
    if r.returncode != 0:
        raise RuntimeError("`gh` not available or failed (--version). Install GitHub CLI.")
