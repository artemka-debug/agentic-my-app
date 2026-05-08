# Human approval gate — decomposition

**Run ID:** {{RUN_ID}}  
**Task brief:** {{TASK_BRIEF_ID}}  
**Recorded (UTC):** {{GENERATED_AT}}

Complete this checklist **before** creating worktrees / spawning Aider workers (unless autonomy mode skips gates — see `state.json` and harness config).

## Checklist

- [ ] Requirements (`requirements.md` / `requirements.json`) reviewed and satisfactory
- [ ] Open questions answered or explicitly deferred with rationale
- [ ] Acceptance criteria clearly testable
- [ ] Edge cases enumerated with expected behaviors
- [ ] Security / privacy notes acknowledged
- [ ] Decomposition (`decomposition.md`) reflects realistic work packages
- [ ] `work-packages.json` assigns sensible requirement IDs to workers
- [ ] `verification-matrix.md` lists required checks for this task
- [ ] Candidate strategies (`candidate-strategies.json`) make sense for this issue

## Approver

- **Name / handle:** __________________________
- **Decision:** APPROVED / REJECTED / APPROVED WITH NOTES
- **Notes:**

---

When approved, the harness proceeds to Phase 4 (worktrees + Aider). Rejection should include concrete edits requested for requirements or decomposition.
