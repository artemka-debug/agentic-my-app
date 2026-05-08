# BMAD + Agent OS (Cursor-local workflow)

Templates and scripts aligned with `docs/plan.md`.

## Quick start

1. Copy `templates/dot-agentic/` layout into your repo as `.agentic/` and add `config.yaml` from `config.example.yaml` (validate with `schemas/config.schema.json` if desired).
2. GitHub intake:

   ```bash
   python3 scripts/github_intake.py owner/repo 42 --agentic-root /path/to/your/repo
   ```

3. Agent OS scaffold:

   ```bash
   python3 scripts/scaffold_agent_os.py --root /path/to/your/repo --slug 2026-05-08-issue-42-my-feature
   ```

Further phases (worktrees, verification, PR monitor) are tracked in `PROGRESS.md`.
