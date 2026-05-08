# Implementation progress — mini-SWE / SWE-agent workers

Mark `[x]` only when fully complete.

## Rollout phases (from docs/plan.md)

- [ ] Phase 1: Local orchestrator foundation (run dir, state machine, config, worktrees, status, command runner).
- [ ] Phase 2: GitHub issue intake (adapter, normalization, manual baseline).
- [ ] Phase 3: PO requirements agent (templates, IDs, approval, persistence).
- [ ] Phase 4: Decomposition agent (task graph, risk, approval, decomposition.md).
- [ ] Phase 5: Local worker fanout (worktrees, backend interface, cursor + mini-swe + swe stubs).
- [ ] Phase 6: Verification engine (deterministic runner, profiles, matrix, scoring).
- [ ] Phase 7: Retry loop (feedback, limits, flaky handling, conflicts).
- [ ] Phase 8: Security review (scans, prompts, blocking policy).
- [ ] Phase 9: Finalization and PR creation.
- [ ] Phase 10: PR monitoring manager.
- [ ] Phase 11: UX polish and extensibility (adapters, presets, cleanup, docs).

## Acceptance criteria block in plan

- [ ] End-to-end acceptance: issue → PO → decomposition → fanout → verify → PR → monitor (as specified in plan “Acceptance Criteria For This System”).

## Notes

- Canonical spec: `docs/plan.md`.
