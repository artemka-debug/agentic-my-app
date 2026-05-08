---
name: local-worktree-implementer
description: >-
  STUB Phase 2: implement one candidate in an isolated git worktree using the approved spec,
  decomposition, and candidate brief. Phase 1 only documents the contract; hooks/scripts will
  create worktrees in a later rollout.
---

# Local worktree implementer (stub)

## When to use (target behavior)

- After decomposition is approved and each candidate has an **`implementation-briefs/candidate-*.md`**.
- Operator wants parallel implementations in separate worktrees (see `docs/plan.md` §4.5 and §6).

## Phase 1 scope

- **Foundation only:** this skill defines the intended artifact layout and agent behavior; automated worktree provisioning lives under `hooks/scripts/` (see `create-worktree.sh` stub) and Phase 2.

## Intended flow (reference)

1. Create or enter worktree path (see `worktrees.root` and branch naming in config + `docs/state-layout.md`).
2. Implement changes per brief; stay within **`implementation-agent-behavior`** rule.
3. Write per-candidate outputs:

   - `.agent-workflows/<task-id>/candidates/<candidate-id>/summary.md`
   - `changed-files.txt`
   - `self-check.md`
   - `verification.log` (lightweight local checks run in the worktree)

4. Update **`state.json`** candidate entry: `implemented` / `verifying` as appropriate.

## Outputs (target)

- `.agent-workflows/<task-id>/candidates/<candidate-id>/` artifact set per `docs/state-layout.md`.

## Next steps

- Wire **`before-implementation-agent`** / worktree hooks when Phase 2 lands; until then, humans can create worktrees manually or run stub scripts from README.
