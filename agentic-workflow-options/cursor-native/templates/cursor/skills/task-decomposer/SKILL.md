---
name: task-decomposer
description: >-
  Split approved requirements into implementation tasks, candidate briefs, and verification-plan.md;
  enforce human approval after decomposition when gates require it.
---

# Task decomposer

## When to use

- `requirements.json` is in good shape for the current `taskId`.
- Ready to produce implementation briefs and verification plan before parallel implementation.

## Steps

1. Read `requirements.*` and intake; confirm no blocking open questions (or document waived risks).
2. Write **`decomposition.md`**: ordered tasks, file-area hints, risk notes, suggested candidate strategies (align with `implementation.diversity` in config).
3. Write **`implementation-briefs/candidate-*.md`** (one per planned candidate, e.g. `candidate-a`, `candidate-b`): scope, strategy, commands to run, explicit out-of-scope items.
4. Write **`verification-plan.md`**: which verification methods apply per requirement, edge cases, and command expectations from config.
5. **Gate:** If `gates.requireApprovalAfterDecomposition` is true in `.cursor-agent-workflow.yaml`, **stop** and ask the human to approve before any worktree implementation (see **`human-approval-gates`** rule).
6. Update **`state.json`** to `decomposition-complete` and, after human approval when required, `decomposition-approved`.

## Outputs

- `.agent-workflows/<task-id>/decomposition.md`
- `.agent-workflows/<task-id>/implementation-briefs/*.md`
- `.agent-workflows/<task-id>/verification-plan.md`

## Notes

- Candidate count and naming should match `implementation.candidateCount` and branch conventions in `docs/state-layout.md`.
