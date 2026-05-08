# `.agentic` artifact layout (template)

Copy this tree to your repository root as `.agentic/` (alongside `config.yaml` generated from `config.example.yaml`).

## Directory shape

```text
.agentic/
  config.yaml
  runs/
    <run-id>/
      intake.json
      requirements.md
      spec.md
      tasks.md
      decomposition.json
      approval.json
      worktrees.json
      candidates/
        candidate-a/
          task-assignment.md
          implementation-log.md
          verification-report.md
          requirement-coverage.json
          security-review.md
          code-review.md
      final/
        selected-candidate.md
        pr-body.md
        final-verification.md
        traceability.md
        handoff.md
  templates/
    prompts/
    reports/
```

Runs are created by `scripts/github_intake.py` and `scripts/scaffold_agent_os.py`. Prompt/report templates under `templates/` are optional starters for Cursor agents.
