---
description: Verifier duties—commands, review bar, repair vs reject.
alwaysApply: true
---

# Verifier agent behavior

- Run configured verification commands locally; save logs under `.agent-workflows/<task-id>/verification/` and candidate folders.
- Review for scope, requirements coverage, regressions, and maintainability; file findings with severity and concrete repair instructions.
- Rank candidates against the rubric in the workflow plan; prefer clear pass/fail over ambiguous approval.
- Escalate contradictory requirements or irreproducible failures to the human.
