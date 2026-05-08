# `.agent-workflows/` state layout

Workflow state and artifacts live under the directory named in `artifacts.root` inside `.cursor-agent-workflow.yaml` (default: `.agent-workflows` at the **consumer repository** root). Paths below are relative to that root.

## Task ID convention

Use a stable, filesystem-safe ID per workflow run, for example:

| Source | Pattern | Example |
|--------|---------|---------|
| GitHub issue | `gh-<issue-number>-<short-slug>` | `gh-123-fix-login-redirect` |
| Direct prompt / other | `task-<date>-<short-slug>` | `task-20260508-refactor-cache` |

Rules:

- Lowercase, hyphen-separated slug derived from issue title or summary (collapse spaces, strip unsafe chars).
- Reuse the same `taskId` for all artifacts of one run (intake through PR).

## Directory layout per task

```text
.agent-workflows/<task-id>/
  state.json                 # Workflow state machine position, candidates, PR URL
  config.snapshot.yaml       # Optional copy of effective config at run start
  intake.md
  intake.json
  requirements.md
  requirements.json
  decomposition.md
  verification-plan.md
  implementation-briefs/
    candidate-a.md
    candidate-b.md
    ...
  candidates/
    <candidate-id>/
      summary.md
      changed-files.txt
      self-check.md
      verification.log
  verification/
    <candidate-id>.md
    coverage-matrix.md
    ranking.md
    final-recommendation.md
  pr/
    body.md
    url.txt
  logs/
    ...                      # Optional per-agent or per-step logs
```

## Worktrees (parallel candidates)

By default, git worktrees are created **outside** the repo under `worktrees.root` (e.g. `../.agent-worktrees/<repo-name>-<task-id>-<candidate-id>/`). Branch naming:

```text
<branchPrefix>/<issue-number>-<slug>/candidate-a
<branchPrefix>/<issue-number>-<slug>/candidate-b
...
<branchPrefix>/<issue-number>-<slug>/final
```

See `docs/plan.md` §6 for alternatives and cleanup policy.

## State machine (reference)

See `docs/plan.md` §14 for canonical statuses, e.g. `initialized` → `intake-complete` → `requirements-drafted` → … → `pr-created` / `completed` / `failed`.
