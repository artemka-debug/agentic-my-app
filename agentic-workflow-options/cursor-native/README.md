# Cursor-native agentic workflow (portable bundle)

This folder is a **portable template pack**. It does **not** modify the parent repo’s `.cursor/` tree. Copy artifacts into a **consumer** repository when you want the workflow.

- **Spec:** `docs/plan.md`
- **State layout & task IDs:** `docs/state-layout.md`
- **Workflow config template:** `templates/.cursor-agent-workflow.yaml` → copy to consumer repo **root** as `.cursor-agent-workflow.yaml`

## Install (consumer repo)

1. **Config**
   - Copy `templates/.cursor-agent-workflow.yaml` to `<consumer-root>/.cursor-agent-workflow.yaml`.
   - Edit `verification.commands`, `worktrees`, `github`, and package-manager commands for your project.

2. **Cursor rules**
   - Copy each file from `templates/cursor/rules/` to `<consumer-root>/.cursor/rules/` (same filenames).

3. **Cursor skills**
   - Copy each skill directory from `templates/cursor/skills/` to `<consumer-root>/.cursor/skills/` (each skill is a folder containing `SKILL.md`).

4. **Hooks (optional)**
   - Copy `hooks/scripts/*` to `<consumer-root>/.cursor/hooks/scripts/`.
   - Merge `hooks/hooks.example.json` into your existing **project** hooks file, or create `<consumer-root>/.cursor/hooks.json` from it (see [Cursor hooks](https://cursor.com/docs); paths in JSON are relative to the consumer repo and assume scripts live under `.cursor/hooks/scripts/`).
   - Adjust `sessionStart` / add events as needed; the provided sample only runs `validate-workflow-start.sh`.

5. **Artifacts directory**
   - No copy required. The workflow writes under `.agent-workflows/` in the consumer repo per `artifacts.root` in the YAML (see `docs/state-layout.md`).

## Inventory (plan §5) vs this bundle

| Item | In this folder | Notes |
|------|----------------|-------|
| `.cursor-agent-workflow.yaml` | `templates/.cursor-agent-workflow.yaml` | Full example from plan §16 |
| Rules 1–8 (`workflow-local-only` … `human-approval-gates`) | `templates/cursor/rules/*.md` | Portable project rules |
| Skill `github-issue-intake` | `templates/cursor/skills/github-issue-intake/SKILL.md` | Phase 1 |
| Skill `po-spec-writer` | `templates/cursor/skills/po-spec-writer/SKILL.md` | Phase 1 |
| Skill `task-decomposer` | `templates/cursor/skills/task-decomposer/SKILL.md` | Phase 1 + decomposition gate |
| Skill `local-worktree-implementer` | `templates/cursor/skills/local-worktree-implementer/SKILL.md` | **Stub** (Phase 2) |
| Skills `candidate-verifier` … `pr-monitor-manager` | — | Later phases |
| Hooks | `hooks/hooks.example.json`, `hooks/scripts/*` | **Stubs**; extend per plan §5 |

## Usage sketch

1. Set `taskId` (see `docs/state-layout.md`).
2. Run **GitHub issue intake** → writes `intake.*`.
3. Run **PO spec writer** → writes `requirements.*`.
4. Run **task decomposer** → writes `decomposition.md`, `implementation-briefs/*`, `verification-plan.md`; **pause for human approval** if `gates.requireApprovalAfterDecomposition` is true.
5. Later phases: worktree implementation, verification, PR finalization, monitor (see `docs/plan.md` §19).

## Related

- Progress checklist: `PROGRESS.md`
