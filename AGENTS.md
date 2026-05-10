## Learned User Preferences

- For agentic implementation workflows tied to this project, keep execution local-only; do not rely on cloud agents for the implementation loop.
- Treat Cursor as the primary harness: orchestration, prompts, and quality gates should stay Cursor-centric rather than adopting a different IDE agent as the main controller.
- Workflow shape the user targets: GitHub issues as the primary task intake, parallel local git worktrees for competing implementation attempts, and a GitHub PR as the usual completion artifact.
- When human gates are enabled, checkpoint during PO/spec/decomposition and tool choice before broad coding; allow modes that skip mandatory gates for autonomy-focused runs.
- After scope is approved, prefer an aggressive autonomous loop: implement, verify, and retry until genuinely blocked rather than pausing on every small uncertainty.
- Expect verification to cover lint and typecheck, targeted unit and integration tests (plus browser or e2e checks when the change is user-visible), separate code review and security review passes, and traceability to stated requirements.
- When coordinating multiple subagents across `agentic-workflow-options` (or similar parallel implementation passes), keep an explicit progress artifact and mark tasks complete only after full completion; if context window usage exceeds roughly 70%, hand off to a fresh subagent with a short summary of completed work and remaining scope.
- When subagent output is already visible in the UI, do not restate it unless the user asks or multi-result synthesis is needed; close with a brief third-person completion acknowledgment instead of repeating the same summary each time.
- Prefer reusable CLI tooling (for example **agentic-my-app** / a Cursor SDK local CLI) packaged so it can be installed and used globally across repositories, not only inside a single workspace checkout.
- For **agentic-my-app**-style approval UX, auto-approve non-destructive tool calls and ask before deletion, destructive, or otherwise irreversible changes.

## Learned Workspace Facts

- The repo keeps `agentic-workflow-options/` with one subdirectory per architecture option being compared; each option generally has `docs/plan.md` and many folders use `PROGRESS.md` for phase tracking.
- `agentic-workflow-options/aider-workers/scripts/setup-in-repo.sh` bootstraps another git repo by copying **agentic-my-app** (or other) and Aider config templates and optionally patching `default_repo` from `origin`.
- Local runs using `@cursor/sdk` need a resolvable ripgrep binary (for example **`CURSOR_RIPGREP_PATH`** pointing at `rg`, or `configureRipgrepPath()` when exposed by the SDK); otherwise ignore mapping for `.gitignore` / `.cursorignore` can fail with a missing ripgrep path error.
- Hook configurations that only reference long-running scripts (such as PR monitors) may not execute those scripts unless the workflow explicitly invokes that step; relying on the hook entry alone can leave monitors idle unless something in the flow starts them.
- For the **`agentic-my-app`** package in this workspace, PR monitoring is expected to fetch all issue, review, and pull review comments, including author comments; reply with `[Agentic Platform]`, skip only already-prefixed comments, push fixes, keep listening after replies, merge approved PRs, and exit when the PR is merged or closed.
- In **`agentic-my-app`**, `localOnly` means Cursor agents use the SDK local runtime against a local workspace or worktree, not Cursor Cloud.
- In orchestrated runs, verifier failures should loop back to implementation or test-writing agents rather than letting the workflow continue downstream as if verification passed.
- `openhands-local-runtime` currently functions as a local orchestration skeleton: it persists run state and artifacts, but OpenHands adapters still return previews/stubs rather than launching real OpenHands execution.
- `openhands-local-runtime/state-machine.yaml` is a canonical reference, not a central validator; the Python state layer persists history and validates target state names while CLI commands enforce only some transitions manually.
