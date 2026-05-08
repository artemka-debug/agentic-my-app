---
name: github-issue-intake
description: >-
  Fetch and normalize a GitHub issue into local workflow artifacts (intake.md / intake.json)
  under .agent-workflows/<task-id>/. Use when starting from an issue URL/number or when the
  user asks to import GitHub issue context for the cursor-native agentic workflow.
---

# GitHub issue intake

## When to use

- Starting the workflow from a GitHub issue (URL or number).
- Need a normalized task packet before PO spec and decomposition.

## Preconditions

- `gh` installed and authenticated (`gh auth status`).
- Consumer repo matches the issue’s repository (or document cross-repo context in intake).

## Steps

1. Choose **taskId** per `docs/state-layout.md` (e.g. `gh-<n>-<slug>`).
2. Ensure `.agent-workflows/<taskId>/` exists (create directories as needed).
3. Fetch issue data:

   ```bash
   gh issue view <issue> --json title,body,labels,assignees,milestone,comments,url,state,number
   ```

   Add linked PRs or extra comments via `gh api` when needed (see `docs/plan.md` §4.2).

4. Write **`intake.md`**: human-readable summary (title, body, labels, notable comments, links).
5. Write **`intake.json`**: structured fields matching what downstream agents need (ids, urls, comment excerpts, metadata).
6. Update **`state.json`** (or create) with `status` at least `intake-complete` and `source.type: github-issue` (schema in `docs/plan.md` §14).

## Outputs

- `.agent-workflows/<task-id>/intake.md`
- `.agent-workflows/<task-id>/intake.json`
- Updated `.agent-workflows/<task-id>/state.json`

## Escalation

- If `gh` fails or the issue is not accessible, stop and ask the operator to fix auth or permissions.
