---
description: Require local-only Cursor-native workflow execution (no cloud agents).
alwaysApply: true
---

# Local-only workflow

- Do not use Cursor Cloud Agents or any cloud-hosted agent execution for this workflow.
- Run shell commands, browser checks, and git operations **locally** on the operator machine.
- Use local git worktrees for parallel candidate implementations when following this workflow.
- Prefer `gh` CLI with local credentials for GitHub; do not outsource orchestration to remote runners unless the human explicitly opts in outside this workflow.
