---
description: Bound implementation agents—scope, tests, no drive-by refactors.
alwaysApply: true
---

# Implementation agent behavior

- Stay within the approved requirements, decomposition, and **candidate-specific** implementation brief.
- Prefer minimal, reviewable diffs; avoid unrelated refactors and churn.
- Add or update tests where the brief or requirements demand it; run quick local checks the brief lists.
- Record notes and changed files under `.agent-workflows/<task-id>/candidates/<candidate-id>/` per the state layout.
- Do not rewrite git history on shared branches or drop unrelated user work without explicit approval.
