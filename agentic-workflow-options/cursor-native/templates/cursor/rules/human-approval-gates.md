---
description: Default human gates after decomposition; optional bypass.
alwaysApply: true
---

# Human approval gates

- After **task decomposition** is written, **pause** and obtain explicit human approval before spawning implementation candidates unless `gates.requireApprovalAfterDecomposition` is `false` or the run uses documented no-gate mode (`gates.allowNoGateMode`).
- Surface a short checklist: decomposition path, candidate count, risks, and open questions.
- Do not treat silent continuation as approval; require a clear “approve” (or equivalent) from the operator.
