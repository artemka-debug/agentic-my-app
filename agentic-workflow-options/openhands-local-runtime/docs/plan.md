## Local-Only Cursor Harness Spec: OpenHands Runtime As Implementation Engine

### 1. Goal

Build a local agentic implementation workflow where Cursor is the primary harness and coordinator, GitHub issues are the first task source, and OpenHands is optionally used only as a local execution engine through either:

- OpenHands Docker runtime, preferred default for isolation and reproducibility.
- OpenHands local runtime, allowed for controlled environments where direct host execution is acceptable.

The successful output of a task is a GitHub pull request created from locally produced work.

Cloud agents and cloud execution are not used.

---

## 2. Scope

All requested capabilities are in scope:

- GitHub issue intake.
- Product Owner clarification and requirements/spec writing.
- Task decomposition.
- Parallel implementation agents in local git worktrees.
- OpenHands local or Docker runtime as implementation engine.
- Cursor as the main harness and orchestration surface.
- Human approval after decomposition by default.
- Configurable aggressive autonomy with approval gates disabled when desired.
- Verification loop covering requirements, lint, typecheck, unit, integration, browser tests, edge cases, quality, security, and separate code review.
- Candidate retry/fix loops.
- Final PR creation.
- Background PR manager that monitors CI and review comments after PR open.

Non-goal: no hosted/cloud agent runtime, no remote worktree execution, no cloud CI replacement for local verification. GitHub CI may still run after PR creation because the requested workflow includes monitoring CI.

---

## 3. High-Level Architecture

The system has five local layers:

1. **Cursor Harness**
   - Main UX, command entry, orchestration prompts, approval gates, status display.
   - Owns task lifecycle and invokes local runners.
   - Stores state and artifacts locally.

2. **Workflow Orchestrator**
   - A local CLI/daemon invoked from Cursor.
   - Coordinates agents, worktrees, runtime selection, retries, verification, and PR lifecycle.
   - Maintains task state machine.

3. **Agent Runtime Adapter**
   - Abstract interface for implementation engines.
   - First adapters:
     - `cursor-local`: Cursor-native local agent execution.
     - `openhands-docker`: OpenHands headless/CLI with Docker runtime.
     - `openhands-local`: OpenHands headless/CLI with local runtime.

4. **Workspace Manager**
   - Creates one base branch and N local worktrees.
   - Assigns decomposed implementation tasks to candidates.
   - Manages branch naming, patch collection, merge/cherry-pick strategy, and cleanup.

5. **Verification and PR Manager**
   - Runs deterministic local checks.
   - Runs PO coverage checks and independent reviews.
   - Creates PR through GitHub CLI/API.
   - Monitors PR comments, requested changes, and CI until done.

---

## 4. Local Runtime And Container Strategy

Default mode should be `openhands-docker`.

Docker runtime behavior:

- Each implementation candidate gets its own git worktree and container.
- Mount only that worktree into `/workspace:rw`.
- Mount reference docs, specs, and logs as read-only where possible.
- Use per-candidate container names and isolated temp/cache directories.
- Prefer project-specific base images with dependencies preinstalled.
- Limit CPU, memory, network, and mounted paths through config.
- Persist runtime logs outside the container.

Local runtime behavior:

- Runs directly on the host, without sandbox isolation.
- Allowed only when `runtime.mode = "local"` or candidate override explicitly enables it.
- Requires stronger allowlists:
  - permitted commands,
  - permitted paths,
  - forbidden destructive commands,
  - max runtime,
  - confirmation requirement for dependency installs unless autonomy mode allows them.
- Intended for trusted repositories, CI-like machines, or environments where Docker is unavailable.

Both runtimes must support:

- workspace mount,
- environment injection,
- command timeout,
- test command execution,
- artifact collection,
- transcript capture,
- retry with new prompt context.

---

## 5. How Cursor Remains The Harness

Cursor is not replaced by OpenHands.

Cursor responsibilities:

- User-facing task approval and control.
- Agent prompt authoring and review.
- Workflow launch through local commands, tasks, or MCP/tool integration.
- Viewing generated specs, traces, logs, patches, and PR status.
- Manual intervention when needed.

OpenHands responsibilities:

- Acting as one possible local implementation engine.
- Editing code inside an assigned worktree.
- Running local commands inside its configured runtime.
- Returning patch, logs, observations, and summary to the Cursor orchestrator.

The orchestrator treats OpenHands as a worker, not as the system owner.

---

## 6. UX Flow

1. User provides a GitHub issue URL, issue number, or free-form task.
2. Intake agent fetches issue metadata, labels, comments, linked PRs, and repository context.
3. PO agent asks clarifying questions if needed.
4. PO agent writes requirements/spec.
5. Task decomposition agent creates implementation tasks.
6. Cursor asks for human approval by default.
7. If approved, or if `approval.mode = "autonomous"`, implementation begins.
8. N local worktrees are created.
9. Multiple implementation agents run in parallel.
10. Verifier evaluates each candidate.
11. Failed candidates loop back with targeted feedback.
12. Best candidate is finalized.
13. Finalization agent creates branch and PR.
14. Background PR manager monitors CI and review comments.
15. Follow-up fixes are applied locally and pushed until PR is ready.

---

## 7. GitHub Issue Intake And PR Creation

Issue intake should support GitHub first while preserving future source extensibility.

Source adapter model:

```yaml
source:
  type: github_issue
  repo: owner/repo
  issue: 123
```

GitHub issue intake collects:

- title,
- body,
- labels,
- assignees,
- milestone,
- linked issues,
- linked PRs,
- comments,
- checklists,
- screenshots or attachments when accessible,
- repository default branch,
- project conventions from docs and config files.

PR creation uses local git plus `gh`:

- create final branch from selected candidate,
- push branch,
- create PR,
- include requirement traceability,
- include test results,
- include risk notes,
- link source issue,
- assign reviewers if configured.

PR body sections:

- Summary.
- Requirements covered.
- Verification performed.
- Edge cases considered.
- Security review notes.
- Remaining risks.
- Closes/fixes issue reference.

---

## 8. Agent Roles And Prompt Responsibilities

### Intake Agent

Purpose: normalize the task source.

Prompt contract:

- Extract user intent.
- Fetch and summarize GitHub issue context.
- Identify ambiguity.
- Produce `TaskBrief`.

Output:

```yaml
task_brief:
  source:
  problem:
  user_goal:
  known_constraints:
  ambiguity:
  repo_context_needed:
```

### Product Owner Agent

Purpose: turn issue into approved requirements.

Prompt contract:

- Ask clarifying questions only when needed.
- Convert vague requests into testable requirements.
- Define acceptance criteria.
- Identify personas, workflows, edge cases, and nonfunctional requirements.
- Preserve all explicit user requirements.

Output:

```yaml
requirements_spec:
  requirement_ids:
  acceptance_criteria:
  edge_cases:
  constraints:
  definition_of_done:
```

### Decomposition Agent

Purpose: split work into implementation-ready tasks.

Prompt contract:

- Produce small tasks with dependencies.
- Identify parallelizable chunks.
- Assign candidate strategy.
- Define files/modules likely involved without over-constraining implementers.
- Define tests expected per task.

Output:

```yaml
implementation_plan:
  tasks:
    - id:
      objective:
      requirements:
      suggested_areas:
      tests:
      dependencies:
```

### Implementation Agents

Purpose: implement in isolated worktrees.

Prompt contract:

- Work only in assigned worktree.
- Follow repo conventions.
- Keep changes scoped.
- Run required local checks.
- Produce patch summary and self-review.
- Never create PR directly.

Engine choices:

- Cursor local agent.
- OpenHands Docker runtime.
- OpenHands local runtime.

### Verifier Agent

Purpose: independently evaluate candidates.

Prompt contract:

- Check requirements coverage.
- Run configured test suites.
- Inspect diff quality.
- Check edge cases.
- Perform separate code review.
- Perform security review.
- Produce pass/fail with actionable feedback.

### Finalization Agent

Purpose: prepare winning candidate for PR.

Prompt contract:

- Rebase/merge as configured.
- Run final checks.
- Generate PR body.
- Create PR.
- Store artifact bundle.

### PR Manager Agent

Purpose: monitor after PR creation.

Prompt contract:

- Poll GitHub PR comments, review state, and CI.
- Classify feedback.
- Apply clear fixes locally.
- Ask for human input only on ambiguous product decisions or risky changes.
- Push follow-up commits.
- Stop when PR is green and reviewer concerns are resolved.

---

## 9. Requirement Traceability Model

Every requirement gets a stable ID.

Example:

```yaml
requirements:
  REQ-001:
    text: "User can start workflow from a GitHub issue."
    acceptance:
      - "CLI accepts owner/repo#number."
      - "Issue title/body/comments are included in task brief."
    verification:
      tests:
        - "integration:github_issue_intake"
      review:
        - "PO coverage"
        - "code review"
```

Traceability is carried through:

- `TaskBrief`
- `RequirementsSpec`
- decomposition tasks
- implementation prompts
- verifier checklist
- PR body

Each candidate returns:

```yaml
coverage:
  REQ-001:
    status: covered
    evidence:
      - files:
      - tests:
      - notes:
```

Verifier may mark each requirement:

- `covered`
- `partially_covered`
- `not_covered`
- `blocked`
- `needs_human_decision`

---

## 10. Verifier Design

Verifier is a multi-stage local pipeline.

Stages:

1. **Static checks**
   - lint,
   - format check,
   - typecheck,
   - dependency audit where configured.

2. **Automated tests**
   - unit,
   - integration,
   - browser/e2e,
   - regression tests for touched areas.

3. **PO coverage**
   - map implementation to each requirement ID.
   - validate acceptance criteria.
   - check edge cases.

4. **Code review**
   - correctness,
   - maintainability,
   - architecture fit,
   - test quality,
   - unnecessary churn,
   - backwards compatibility.

5. **Security review**
   - secret handling,
   - injection risks,
   - authz/authn impact,
   - unsafe filesystem/network behavior,
   - dependency and supply-chain risks,
   - container/runtime escape risks for workflow code.

6. **Candidate ranking**
   - pass/fail gate,
   - risk score,
   - coverage score,
   - test confidence,
   - diff size,
   - maintainability score.

A candidate passes only if required gates pass or are explicitly waived in config.

---

## 11. Tests And Edge-Case Coverage Strategy

The decomposition agent defines expected tests before implementation.

Verifier enforces:

- Existing test suite remains green.
- New behavior has focused tests.
- Bug fixes include regression tests.
- Browser tests are required for user-visible frontend flows.
- Integration tests are required for external boundaries such as GitHub, filesystem, containers, or CLI orchestration.
- Edge cases from PO spec are checked explicitly.

Edge-case categories:

- missing issue fields,
- private repository auth failures,
- flaky tests,
- merge conflicts,
- dependency install failures,
- multiple candidates editing same logical area,
- partial requirement coverage,
- PR comments requesting conflicting changes,
- CI passing locally but failing remotely,
- Docker unavailable,
- local runtime unsafe command attempts.

---

## 12. Security Review Strategy

Security review has two layers.

Workflow security:

- Prefer Docker runtime.
- Restrict mounts to candidate worktree.
- Avoid mounting home directory or global credentials into containers.
- Pass GitHub token only to orchestrator/finalizer, not arbitrary implementers unless required.
- Redact secrets from logs.
- Require command allowlist or denylist for local runtime.
- Disable destructive commands unless explicitly approved.
- Store artifacts locally with safe permissions.

Code security:

- Review changed code for injection, auth, data exposure, path traversal, SSRF, XSS, unsafe deserialization, insecure crypto, and secret leakage.
- Run configured dependency/security scanners.
- Require human approval for security-sensitive areas if configured.

---

## 13. Worktree Fanout

For each approved implementation task or candidate strategy:

```text
.repo/
.worktrees/
  issue-123-candidate-a/
  issue-123-candidate-b/
  issue-123-candidate-c/
.artifacts/
  issue-123/
```

Fanout modes:

- `single_task_multi_candidate`: multiple agents attempt same task.
- `decomposed_parallel`: different agents implement independent subtasks.
- `hybrid`: multiple candidates per risky subtask, then merge best pieces.

Conflict handling:

- Prefer selecting one winning candidate for simple tasks.
- For decomposed tasks, merge task branches into an integration worktree.
- If merge conflicts occur, send to finalization agent with verifier context.
- If conflicts are risky, require human approval unless autonomy mode allows resolution.

---

## 14. State, Logging, And Artifacts

Local artifact directory:

```text
.agentic/
  config.yaml
  runs/
    RUN_ID/
      task-brief.yaml
      requirements.yaml
      decomposition.yaml
      state.yaml
      worktrees.yaml
      candidates/
        candidate-a/
          prompt.md
          transcript.jsonl
          diff.patch
          test-results/
          verifier-report.yaml
          security-report.yaml
      final/
        pr-body.md
        final-verification.yaml
        pr.json
```

State machine:

```text
intake
clarifying
specified
decomposed
awaiting_approval
implementing
verifying
retrying
finalizing
pr_opened
monitoring_pr
complete
failed
cancelled
```

Logs must include:

- agent prompts,
- model/runtime selected,
- commands run,
- exit codes,
- changed files,
- test results,
- verifier decisions,
- retry reasons,
- PR updates.

---

## 15. Failure And Retry Policy

Failure classes:

- `requirements_ambiguous`: return to PO clarification.
- `implementation_failed`: retry same candidate with error context.
- `verification_failed`: send targeted verifier feedback to implementer.
- `merge_failed`: finalization resolves or asks human.
- `runtime_failed`: restart runtime or switch configured fallback.
- `tests_flaky`: rerun with cap and record flake.
- `security_failed`: block PR unless explicitly waived.
- `ci_failed_after_pr`: PR manager applies fix loop.
- `review_changes_requested`: PR manager applies fix loop.

Retry controls:

```yaml
retry:
  max_candidate_attempts: 3
  max_verifier_loops: 3
  max_pr_followups: 10
  flaky_test_reruns: 2
  allow_runtime_fallback: true
```

---

## 16. Config Schema

Example:

```yaml
version: 1

harness:
  type: cursor
  state_dir: .agentic/runs

source:
  default: github_issue

approval:
  decomposition: required
  before_pr: required
  mode: gated # gated | autonomous

runtime:
  default_engine: openhands-docker
  engines:
    openhands-docker:
      enabled: true
      image: local/agent-runtime:latest
      workspace_mount: /workspace
      network: restricted
      memory: 8g
      cpus: 4
    openhands-local:
      enabled: true
      require_explicit_selection: true
      command_policy: strict
    cursor-local:
      enabled: true

fanout:
  max_parallel_agents: 4
  strategy: hybrid

verification:
  required:
    - lint
    - typecheck
    - unit
    - integration
    - browser
    - code_review
    - security_review
    - po_coverage
  commands:
    lint: npm run lint
    typecheck: npm run typecheck
    unit: npm test
    integration: npm run test:integration
    browser: npm run test:e2e

github:
  use_gh_cli: true
  pr_draft: false
  monitor_ci: true
  monitor_reviews: true
```

---

## 17. CLI And Runner Commands

Suggested commands:

```bash
agentic issue start owner/repo#123
agentic issue start https://github.com/owner/repo/issues/123
agentic spec approve RUN_ID
agentic run RUN_ID
agentic run RUN_ID --autonomous
agentic verify RUN_ID
agentic finalize RUN_ID --create-pr
agentic pr monitor RUN_ID
agentic status RUN_ID
agentic logs RUN_ID --candidate candidate-a
```

OpenHands Docker execution wrapper:

```bash
agentic worker run \
  --engine openhands-docker \
  --worktree .worktrees/issue-123-candidate-a \
  --prompt .agentic/runs/RUN_ID/candidates/a/prompt.md
```

OpenHands local execution wrapper:

```bash
agentic worker run \
  --engine openhands-local \
  --worktree .worktrees/issue-123-candidate-a \
  --prompt .agentic/runs/RUN_ID/candidates/a/prompt.md
```

---

## 18. Rollout Plan

Phase 1: Core local orchestrator

- Implement run state model.
- Add GitHub issue intake.
- Generate PO requirements/spec.
- Generate decomposition.
- Add approval gate.
- Support one local implementation candidate.

Phase 2: Runtime adapters

- Add `cursor-local` adapter.
- Add `openhands-docker` adapter.
- Add `openhands-local` adapter with strict warnings and policy controls.
- Capture transcripts and patches.

Phase 3: Worktree fanout

- Create parallel worktrees.
- Run multiple candidates.
- Add candidate artifact format.
- Add candidate ranking.

Phase 4: Verification pipeline

- Add command-based lint/typecheck/test execution.
- Add PO coverage checker.
- Add independent code review prompt.
- Add security review prompt.
- Add retry loop.

Phase 5: Finalization and PR

- Add final branch creation.
- Add PR body generation.
- Add `gh pr create`.
- Add final verification artifact.

Phase 6: Background PR manager

- Poll CI and reviews.
- Summarize comments.
- Apply clear fixes through local worktree loop.
- Push follow-up commits.
- Stop when PR is green or blocked.

Phase 7: Hardening and customization

- Add richer config schema validation.
- Add runtime resource limits.
- Add policy engine for approvals.
- Add dashboard/status view in Cursor.
- Add future source adapters beyond GitHub issues.

---

## 19. Risks And Mitigations

- **Local runtime can modify host files.** Mitigate by defaulting to Docker, requiring explicit local runtime opt-in, and enforcing path/command policy.
- **Parallel agents can create conflicting changes.** Mitigate with isolated worktrees, candidate ranking, and integration verification.
- **Agents may satisfy tests but miss intent.** Mitigate with requirement IDs, PO coverage checks, and acceptance criteria verification.
- **Autonomy may push risky changes.** Mitigate with configurable gates, security-sensitive path rules, and before-PR approval.
- **Docker runtime may be slower.** Mitigate with cached images, dependency prebuilds, and parallel container reuse where safe.
- **PR monitor may mis-handle review intent.** Mitigate by classifying comments into clear fix, ambiguous, product decision, and blocked.

---

## 20. Pros And Cons

Pros:

- Cursor remains the main control plane.
- Execution stays local.
- Docker mode gives strong isolation and reproducibility.
- OpenHands can be swapped in as an implementation worker without owning the workflow.
- Worktree fanout enables quality through competition and parallelism.
- Requirement traceability makes verification less vibes-based.
- PR monitor closes the loop after opening the PR.

Cons:

- More orchestration complexity than a single-agent flow.
- Docker runtime setup requires project-specific care.
- Local runtime is powerful but risky.
- Parallel worktrees increase disk and compute usage.
- High-quality verification depends on good repo test commands and acceptance criteria.

---

## 21. Definition Of Success

A run is successful when:

- The GitHub issue has been converted into traceable requirements.
- Decomposition was approved or intentionally run autonomously.
- One or more local agents implemented the work in isolated worktrees.
- Verification passed for lint, typecheck, tests, browser/integration where configured, code review, security review, and PO coverage.
- A GitHub PR was created with evidence of requirement coverage.
- PR monitoring is active until CI and review feedback are resolved.

**Clarifying execution specs**

I need to finalize the specifications, ensuring that there are no cloud agents or execution involved. The user seems to suggest a model API and asks to use local models, potentially supporting local LLM providers. It's important to clarify this plan since it could impact the main harness Cursor, which might be more like a SaaS setup. I should make sure execution remains local and that LLM calls can be configured per organization, ensuring no cloud processes are involved.
**Defining execution and features**

I need to clarify that while using the Cursor chat LLM, the code execution stays local, but prompt content can leave the machine. To ensure security, strict mode should utilize a local model when possible. I must include all features requested in scope and make the document self-contained. The content will be concise, and while I aim for structure with headings, it should not exceed 70 lines, balancing detail with brevity. I won’t include tables or canvas if the user only wants a plan or specification.
**Clarifying goals and features**

I need to be careful about excluding features while identifying non-goals. It might be best to omit non-goals except for specifying "not to build a cloud execution path." I’ll include both goals and that cloud non-goal, plus mention a sample YAML for the config schema. I should outline agent roles, prompts, CLI commands, and state/logging artifacts, including aspects of failure and retry. It's also crucial to reference the OpenHands wrapper as an implementation engine linked to the Cursor harness via CLI. Lastly, I need to emphasize human approval for changes and the role of a background reviewer in monitoring PR comments.
