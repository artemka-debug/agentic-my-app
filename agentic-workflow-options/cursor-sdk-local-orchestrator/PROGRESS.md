# Implementation progress — Cursor SDK local orchestrator

Mark `[x]` only when fully complete.

## Rollout phases (from docs/plan.md)

- [ ] Phase 1: Local SDK harness (TS CLI, config, SDK wrapper with cloud guard, logging, run dir, Agent lifecycle smoke test).
- [ ] Phase 2: GitHub issue intake (parse refs, `gh`, TaskInput snapshot).
- [ ] Phase 3: PO and decomposition (prompts/schemas, gates, traceability seed).
- [ ] Phase 4: Worktree + parallel implementers (manager, artifacts, retry scaffolding).
- [ ] Phase 5: Verification harness (command runner, matrix, scoring).
- [ ] Phase 6: Review agents (code, security, PO acceptance, policy).
- [ ] Phase 7: Finalization and PR creation (`gh`, body template).
- [ ] Phase 8: PR monitoring (poll, classify, fix agents, push).
- [ ] Phase 9: Hardening (resume, cancel, redaction, cleanup, status).

## Success criteria (plan)

- [ ] Plan “Success Criteria” section satisfied for this folder’s implementation scope.

## Notes

- Canonical spec: `docs/plan.md`.
- Use `@cursor/sdk` only with local runtime; reject cloud options in wrapper code.
