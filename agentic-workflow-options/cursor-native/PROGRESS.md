# Implementation progress — Cursor-native (Skills, Rules, Hooks)

Mark `[x]` only when fully complete.

## Rollout phases (from docs/plan.md §19)

- [x] Phase 1: Foundation (`.cursor-agent-workflow.yaml`, state dir, task ID convention, intake + PO + decomposition skills, local-only + traceability rules, decomposition gate).
- [ ] Phase 2: Worktree implementation (hooks/scripts, implementation skill, candidate capture, `/best-of-n` wrapper docs, resume).
- [ ] Phase 3: Verification (verifier skill, command runner, browser + PO acceptance, coverage matrix).
- [ ] Phase 4: Security and quality (security skill, audit/secrets hooks, ranking).
- [ ] Phase 5: Finalization and PR (finalizer skill, PR body, `gh pr create`, final gate).
- [ ] Phase 6: PR monitoring (monitor skill, polling, auto-fix policy).
- [ ] Phase 7: Hardening (sources, dashboards artifacts, cleanup, metrics, templates).

## Exact Implementation Phases (from docs/plan.md §22) — align with Skills/Rules/Hooks inventory

- [x] 1. Workflow config schema (`templates/.cursor-agent-workflow.yaml`).
- [x] 2. Artifact/state directory schema under `.agent-workflows/` (`docs/state-layout.md`).
- [x] 3. Local-only Cursor rule (`templates/cursor/rules/workflow-local-only.md`).
- [x] 4. Requirement traceability Cursor rule (`templates/cursor/rules/requirements-traceability.md`).
- [ ] 5–27. Skills, hooks, prompts, CLI/command docs per plan §5 inventory and §22 list (consolidate with phases above; mark each inventory item implemented in README inventory table).

## Notes

- Canonical spec: `docs/plan.md`.
- Prefer portable artifacts in this repo folder; paths in config are relative to the consumer repo when copied (see `README.md`).
