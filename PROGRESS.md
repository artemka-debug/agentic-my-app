# Implementation progress — agentic-my-app

Mark `[x]` only when fully complete.

## Rollout phases (from docs/plan.md)

- [x] Phase 1: Local SDK harness (TS CLI, config, SDK wrapper with cloud guard, logging, run dir, Agent lifecycle smoke test).
- [x] Phase 2: GitHub issue intake (parse refs, `gh issue view` JSON incl. `closingPullRequests`, `gh repo view` default branch, typed `TaskInput`, snapshot under run dir).
- [x] Phase 3: PO and decomposition (`Agent.create` local, prompts in `prompts/`, `requirements.md` + `decomposition.json`, approval gates via `approvals.json` / autonomy flags).
- [x] Phase 4: Worktree manager + parallel or sequential implementers (`git worktree add`, bounded `Promise.all`, candidate artifacts).
- [x] Phase 5: Verification harness (configurable command runner, verifier agent, per-candidate command JSON under `commands/`).
- [x] Phase 6: Review agents (code + security + PO acceptance as sequential `agent.send` passes with per-pass models).
- [x] Phase 7: Finalization (`finalize.md` agent), `git push`, `gh pr create` with `--base` / `--body-file`.
- [x] Phase 8: PR monitor (poll with `maxPollCycles`, CI failure fix loop with cap, `monitor/events.jsonl` + `poll.jsonl`).
- [x] Phase 9: Hardening (`resume` / `workflow` / `cancel`, transcript + JSONL redaction helpers, `sdk-resume` for persisted agent IDs, `status`, cleanup hooks via worktree remove).

## Success criteria (plan)

- [x] For this repo: end-to-end wiring exists from intake → plan → implement → verify/review → PR → optional monitor; **local SDK only** (`createLocalAgent` / explicit `Agent.resume` with `local`); cloud options rejected in `src/sdk/createLocalAgent.ts`. Full “every gate passes on real repos” depends on local Cursor, `gh`, and repo policies—not asserted in CI here.

## Notes

- Canonical spec: `docs/plan.md`.
- Prompt templates: directory `prompts/` (loaded at runtime from the package root).
- Default config extended in `src/config/types.ts` / `agentic-my-app init` YAML for verification, workflow parallelism, monitoring, and artifact redaction toggles.
