---
description: Map implementation and tests to requirement IDs.
alwaysApply: true
---

# Requirements traceability

- Use stable requirement IDs (e.g. `REQ-001`) from `requirements.json` / `requirements.md` as the contract.
- Every material code or test change should map to at least one requirement ID, test need noted in the decomposition, or an explicit waiver documented in workflow artifacts.
- Before final PR creation, ensure every **must** requirement is `covered` or explicitly `waived` with rationale (see `docs/plan.md` §8 in the cursor-native bundle).
- When summarizing work, cite requirement IDs in commit messages or PR sections where helpful.
