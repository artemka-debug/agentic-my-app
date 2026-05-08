# Implementation progress — OpenCode / Claude Code / Amp workers

Mark `[x]` only when fully complete.

## Implementation phases (from docs/plan.md §27)

- [x] Phase 1: Harness skeleton (run state, artifacts, config, GitHub + manual intake, basic CLI).
- [x] Phase 2: Requirements and decomposition (schemas, approval gate, plan summary).
- [ ] Phase 3: Worktree orchestration (create/cleanup, branches, prompts). _Stub scripts: `scripts/worktree-*.sh`, `workers spawn` prints paths._
- [ ] Phase 4: Worker adapters (OpenCode, Claude Code, Amp, result normalization). _Stub adapters + `bin/agentic-worker-*` placeholders._
- [ ] Phase 5: Verification pipeline (discovery, commands, reviews, scoring).
- [ ] Phase 6: Retry loop (feedback, limits, classification, escalation).
- [ ] Phase 7: Finalization and PR creation.
- [ ] Phase 8: PR monitoring manager.
- [ ] Phase 9: Customization and profiles.
- [ ] Phase 10: Hardening (redaction, permissions, resume, cross-platform).

## Notes

- Canonical spec: `docs/plan.md`.
- **Phase 1–2** deliverables: `agentic-task` CLI (`pip install -e .`), `.agent-runs/<run-id>/` layout (`state.yaml`, `intake.yaml`, `requirements.yaml`, `decomposition.yaml`), `config/default.agentic-task.yaml`, schema stubs under `schemas/`, `approve` / `resume` / printed plan summary.
- **Phase 3+** this run: executable placeholders only — see `README.md`, `scripts/`, `bin/`, and `agentic_task/adapters/`.
