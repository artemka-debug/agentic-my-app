# Local CLI workers harness (skeleton)

Cursor remains the orchestration harness; this folder provides a **`agentic-task` CLI** that owns on-disk run state under **`.agent-runs/`** (configurable), matching `docs/plan.md`.

## Quick start

From **this directory** (scope is intentionally self-contained):

```bash
cd agentic-workflow-options/local-cli-workers-opencode-claude-amp
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
```

Runs are created in the **current working directory** of the shell (typically your real git repo), not inside this package folder:

```bash
cd /path/to/your/repo
agentic-task start --issue owner/repo#123
# or
agentic-task start --prompt "Implement feature X"
# or
agentic-task start --spec ./specs/task.md

# planning-only (state: planning)
agentic-task plan --issue owner/repo#123

# after editing .agent-runs/<run-id>/{requirements,decomposition}.yaml
agentic-task approve --run run-2026-05-08-120000

agentic-task resume --run run-2026-05-08-120000

# Phase 3 stub — prints candidate paths, optionally invokes scripts/worktree-create.sh
agentic-task workers spawn --run run-2026-05-08-120000 --fanout balanced

# Phase 4 stub — materializes workers/<id>/prompt.md and prints placeholder argv
agentic-task worker run --engine opencode --run-id run-2026-05-08-120000 \
  --candidate-id opencode-001 --worktree .worktrees/run-2026-05-08-120000/candidate-opencode-001
```

### Configuration

- Bundled default: `config/default.agentic-task.yaml`
- Override with `agentic-task.yaml` or `.agentic-task.yaml` in the **repo cwd**, or `AGENTIC_TASK_CONFIG=/abs/path.yaml`.

### GitHub intake

If [`gh`](https://cli.github.com/) is installed and authenticated, `agentic-task start --issue` fetches issue JSON. Otherwise a **placeholder** intake is still written from the URL / `owner/repo#num` you pass.

### Schemas (Phase 2 stubs)

- `schemas/requirements.schema.yaml` — requirements / PO output shape
- `schemas/decomposition.schema.yaml` — task DAG shape

YAML under `.agent-runs/<run>/` references these via `_schema_stub` for documentation only (no validator bundled yet).

### Worker / worktree placeholders

- `scripts/worktree-create.sh` / `worktree-cleanup.sh` — Phase 3 stubs (mkdir / no-op)
- `bin/agentic-worker-{opencode,claude,amp}` — Phase 4 executable placeholders wired from Python adapters

Canonical specification: **`docs/plan.md`**. Progress: **`PROGRESS.md`**.
