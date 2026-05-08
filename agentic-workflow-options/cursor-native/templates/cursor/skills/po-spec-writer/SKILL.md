---
name: po-spec-writer
description: >-
  Turn normalized intake into requirements with REQ-* IDs, acceptance criteria, and
  verification methods. Use after intake is complete or when clarifying scope from a task packet.
---

# Product Owner spec writer

## When to use

- `intake.md` / `intake.json` exist for the current `taskId`.
- Need `requirements.md` and `requirements.json` before decomposition.

## Steps

1. Read intake artifacts and `.cursor-agent-workflow.yaml` (or snapshot) for constraints.
2. Draft **`requirements.md`**: narrative spec, open questions, non-functional constraints, user-visible behavior.
3. Produce **`requirements.json`**: array (or map) of requirements. Each item should include at minimum:

   - `id` (e.g. `REQ-001`)
   - `title`, `description`
   - `source` (issue URL + pointer to comment/section if applicable)
   - `priority`: `must` | `should` | `could`
   - `acceptanceCriteria` (observable checks)
   - `verificationMethods` (e.g. `unit`, `integration`, `browser`, `manual-review`, `security-review`)
   - `status`: start as `pending`

   Schema reference: `docs/plan.md` §4.3.

4. If ambiguity blocks implementation, list questions in `requirements.md` and pause for the human before decomposition.
5. Update **`state.json`**: e.g. `requirements-drafted` (and `requirements-approved` only after explicit human sign-off if you enforce that gate).

## Outputs

- `.agent-workflows/<task-id>/requirements.md`
- `.agent-workflows/<task-id>/requirements.json`

## Traceability

- Follow **`requirements-traceability`** project rule: stable IDs and explicit mapping from issue text to requirements.
