# Implementation progress — BMAD + Agent OS variant

Work only in this folder unless integrating with shared tooling. Mark `[x]` only when the item is fully implemented and verified.

## Exact Implementation Phases (from docs/plan.md)

- [ ] 1. Define `.agentic/config.yaml` schema and artifact structure (templates in this folder).
- [ ] 2. GitHub issue intake using local `gh`.
- [ ] 3. Agent OS-style `standards/product/specs` artifact generation.
- [ ] 4. BMAD-style PO clarification and readiness prompt templates.
- [ ] 5. Formal spec generation step/tooling.
- [ ] 6. Task decomposition with approval gate.
- [ ] 7. Worktree manager (scripts or lib).
- [ ] 8. Implementation-agent prompt generator.
- [ ] 9. Candidate execution workflow (local worktree + Cursor-oriented prompts).
- [ ] 10. Verification command runner.
- [ ] 11. Requirement traceability generator.
- [ ] 12. Independent code review agent prompts/artifacts.
- [ ] 13. Security review agent prompts/artifacts.
- [ ] 14. PO acceptance checker artifacts.
- [ ] 15. Retry loop with targeted verifier feedback.
- [ ] 16. Candidate ranking and selection.
- [ ] 17. Final branch assembly.
- [ ] 18. Final verification.
- [ ] 19. PR body generation and `gh pr create` integration.
- [ ] 20. PR monitor for CI and comments.
- [ ] 21. Reviewer-comment fix loop (documented + hooks/skills if applicable).
- [ ] 22. Cleanup/archive commands.
- [ ] 23. Cursor Skills (stubs or full SKILL.md set per plan).
- [ ] 24. Cursor Rules (stubs or full rules per plan).
- [ ] 25. Cursor Hooks (hooks.json + scripts per plan).
- [ ] 26. Documentation and example workflows in this folder.
- [ ] 27. Task-source adapter interface for future sources.

## Notes

- Canonical spec: `docs/plan.md`.
