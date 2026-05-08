## Specification: Local Cursor Harness With Aider Worker Orchestration

### Executive Summary

Build a fully local agentic implementation system where **Cursor is the main harness**, coordinating a structured workflow from GitHub issue intake to pull request completion. Cursor owns task intake, clarification, decomposition, orchestration, verification, finalization, and PR monitoring. **Aider is used only as a local implementation worker CLI**, spawned inside isolated local git worktrees.

The successful output of a task is a GitHub pull request that has passed local verification, requirement coverage checks, code review, security review, and initial CI monitoring. No cloud agents or cloud execution are used. All agents, logs, worktrees, verification, and orchestration run locally on the developer machine.

---

## 1. Goals

1. Implement GitHub issues through an agentic local workflow.
2. Keep Cursor as the primary harness and decision-making environment.
3. Use Aider only as a local worker process for code implementation.
4. Support multiple parallel implementation candidates in isolated git worktrees.
5. Require human approval after task decomposition by default.
6. Allow configurable aggressive autonomy with optional gates.
7. Verify candidates against requirements, tests, edge cases, quality, security, and PO acceptance criteria.
8. Create a GitHub PR as the successful task artifact.
9. Monitor the PR after creation for CI failures and reviewer comments.
10. Preserve high customizability through prompts, config files, policies, and workflow stages.
11. Design intake around GitHub issues first, while leaving the source abstraction open for future inputs.

---

## 2. Non-Goals

These do not exclude any requested feature.

1. Do not use cloud agents or cloud execution.
2. Do not require Aider to become the main orchestrator.
3. Do not require a specific LLM provider beyond what local Cursor and local Aider execution are configured to use.
4. Do not require a hosted backend service.
5. Do not require replacing GitHub as the first PR target.

---

## 3. High-Level Architecture

```text
User / GitHub Issue
        |
        v
Cursor Main Harness
        |
        +--> Product Owner Agent
        |       - clarify task
        |       - write requirements
        |       - define acceptance criteria
        |
        +--> Task Decomposition Agent
        |       - split implementation plan
        |       - define work packages
        |       - create verification matrix
        |
        +--> Human Approval Gate
        |       - default enabled
        |       - configurable bypass
        |
        +--> Local Orchestrator
        |       - creates worktrees
        |       - spawns Aider workers
        |       - tracks candidates
        |
        +--> Aider Worker N
        |       - local CLI only
        |       - isolated git worktree
        |       - implementation candidate
        |
        +--> Verifier Agent
        |       - tests
        |       - lint/typecheck
        |       - review
        |       - security
        |       - browser/integration
        |       - requirements coverage
        |
        +--> Retry / Feedback Loop
        |       - failed candidates receive verifier findings
        |       - workers revise in place or new candidate is spawned
        |
        +--> Finalization Agent
        |       - selects winning candidate
        |       - prepares branch
        |       - creates PR
        |
        +--> PR Manager / Background Reviewer
                - monitors CI
                - reads comments
                - patches follow-up issues locally
```

---

## 4. Core Design Principle: Cursor Remains The Harness

Cursor is the authoritative controller for the workflow. It owns:

1. Reading the GitHub issue.
2. Asking clarifying questions.
3. Producing the requirements/spec.
4. Decomposing implementation tasks.
5. Asking for human approval.
6. Creating local worktrees.
7. Spawning Aider workers.
8. Feeding Aider constrained implementation prompts.
9. Running verification.
10. Comparing candidates.
11. Creating the final PR.
12. Monitoring CI and review comments.

Aider is not allowed to orchestrate other workers, create its own workflow, decide task scope, or bypass Cursor-managed gates. It is a local implementation subprocess.

---

## 5. Source Intake Model

### 5.1 First-Class Source: GitHub Issues

Initial implementation source is a GitHub issue.

Supported intake forms:

```bash
local-orchestrator issue https://github.com/org/repo/issues/123
local-orchestrator issue org/repo#123
local-orchestrator issue 123 --repo org/repo
```

The harness fetches:

1. Issue title.
2. Issue body.
3. Labels.
4. Milestone.
5. Assignees.
6. Comments.
7. Linked PRs.
8. Related references.
9. Existing branch context.
10. Any issue templates or checklists.

Recommended GitHub access:

```bash
gh issue view 123 --repo org/repo --comments --json title,body,comments,labels,assignees,milestone,url
```

### 5.2 Future Source Abstraction

Although GitHub issues are first, the internal source model should be generic:

```ts
type TaskSource =
  | { kind: "github_issue"; repo: string; issueNumber: number; url: string }
  | { kind: "manual"; title: string; body: string }
  | { kind: "notion"; pageId: string }
  | { kind: "linear"; issueId: string }
  | { kind: "file"; path: string };
```

Every source normalizes into a `TaskBrief`.

```ts
type TaskBrief = {
  id: string;
  source: TaskSource;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  rawArtifacts: ArtifactRef[];
};
```

---

## 6. UX Flow

### 6.1 Default Human-Gated Flow

```bash
local-orchestrator issue org/repo#123
```

Flow:

1. Cursor harness fetches the issue.
2. Product Owner agent drafts:
   - problem statement
   - requirements
   - assumptions
   - open questions
   - acceptance criteria
3. User answers clarifying questions if needed.
4. Decomposition agent creates implementation tasks.
5. User approves the decomposition.
6. Orchestrator creates parallel local worktrees.
7. Aider workers implement candidates.
8. Verifier evaluates each candidate.
9. Failed candidates loop back with feedback.
10. Winning candidate is finalized.
11. PR is created.
12. PR manager monitors CI and comments.

### 6.2 Aggressive Autonomous Flow

```bash
local-orchestrator issue org/repo#123 --autonomy aggressive
```

Behavior:

1. Clarifying questions are avoided unless the task is blocked.
2. Decomposition approval can be skipped if configured.
3. Multiple candidates are spawned automatically.
4. Verification gates still run.
5. PR is created when quality threshold is met.

### 6.3 No Mandatory Gates

```bash
local-orchestrator issue org/repo#123 --no-approval-gates
```

Approval gates become advisory checkpoints. The system logs what would have required approval but proceeds.

---

## 7. Configuration

### 7.1 Main Orchestrator Config

Example: `.cursor-local-orchestrator.yml`

```yaml
version: 1

harness:
  name: cursor
  execution: local
  cloud_agents: false
  cloud_execution: false

intake:
  default_source: github_issue
  github:
    default_repo: org/repo
    fetch_comments: true
    fetch_linked_prs: true

autonomy:
  mode: balanced
  require_human_approval_after_decomposition: true
  allow_no_gate_mode: true
  stop_for_ambiguity: true
  stop_for_security_sensitive_changes: true

workers:
  implementation_worker: aider
  max_parallel_workers: 4
  max_attempts_per_candidate: 3
  max_total_attempts: 8
  worktree_root: .orchestrator/worktrees
  branch_prefix: agent
  preserve_failed_worktrees: true

verification:
  required:
    lint: true
    typecheck: true
    unit_tests: true
    integration_tests: true
    browser_tests: true
    code_review: true
    security_review: true
    requirements_coverage: true
  commands:
    lint: npm run lint
    typecheck: npm run typecheck
    unit_tests: npm test
    integration_tests: npm run test:integration
    browser_tests: npm run test:e2e
  allow_command_overrides_per_repo: true

quality:
  require_clean_git_diff: true
  require_no_untracked_secrets: true
  require_no_debug_logs: true
  require_no_unrelated_refactors: true
  require_tests_for_behavior_changes: true

github:
  create_pr: true
  draft_pr: false
  base_branch: main
  push_remote: origin
  pr_title_template: "{issue_number}: {title}"
  pr_body_template: ".orchestrator/templates/pr_body.md"
  monitor_ci: true
  monitor_review_comments: true

logging:
  root: .orchestrator/runs
  retain_artifacts: true
  redact_secrets: true
  write_jsonl_events: true
  write_markdown_summary: true
```

### 7.2 Aider Config

Example: `.aider.conf.yml`

```yaml
auto-commits: false
dirty-commits: false
attribute-author: false
attribute-committer: false
analytics: false
pretty: true
stream: true
yes-always: false
gitignore: true

read:
  - README.md
  - package.json

lint-cmd: npm run lint
test-cmd: npm test

model: ${AIDER_MODEL}
editor-model: ${AIDER_EDITOR_MODEL}

map-tokens: 2048
auto-lint: false
auto-test: false
```

Important policy:

1. Aider does not auto-commit.
2. Cursor decides when to commit.
3. Aider works only in its assigned worktree.
4. Aider receives a constrained prompt and task packet.
5. Aider does not create PRs.

---

## 8. Worktree Strategy

### 8.1 Worktree Layout

```text
repo/
  .orchestrator/
    runs/
      run-2026-05-08-issue-123/
        state.json
        events.jsonl
        requirements.md
        decomposition.md
        verification-matrix.md
        candidates/
          candidate-a/
            prompt.md
            verifier-report.md
            aider.log
          candidate-b/
            prompt.md
            verifier-report.md
            aider.log
    worktrees/
      issue-123-candidate-a/
      issue-123-candidate-b/
      issue-123-candidate-c/
```

### 8.2 Branch Naming

```text
agent/issue-123/candidate-a
agent/issue-123/candidate-b
agent/issue-123/final
```

### 8.3 Worktree Commands

Create candidate worktree:

```bash
git fetch origin
git worktree add .orchestrator/worktrees/issue-123-candidate-a -b agent/issue-123/candidate-a origin/main
```

Remove failed worktree when configured:

```bash
git worktree remove .orchestrator/worktrees/issue-123-candidate-a
git branch -D agent/issue-123/candidate-a
```

Preserve failed worktrees by default for debugging.

---

## 9. Agent Roles

### 9.1 Product Owner Agent

Responsibilities:

1. Understand the task.
2. Clarify ambiguity.
3. Convert issue into implementation-ready requirements.
4. Define acceptance criteria.
5. Identify impacted user journeys.
6. Identify edge cases.
7. Identify nonfunctional requirements.
8. Identify test obligations.
9. Identify security/privacy implications.

Prompt skeleton:

```text
You are the Product Owner agent inside a local Cursor harness.

Given the task source below, produce an implementation-ready requirements spec.

You must:
- preserve the user's intent
- identify ambiguities
- ask clarifying questions only when needed
- define acceptance criteria
- define edge cases
- define expected tests
- define security/privacy considerations
- produce requirement IDs for traceability

Do not implement code.
Do not use cloud execution.
Output structured Markdown and JSON requirement records.
```

Requirement example:

```yaml
id: REQ-001
title: GitHub issue intake
description: The system must accept a GitHub issue URL and fetch title, body, labels, and comments.
acceptance:
  - Given a valid GitHub issue URL, the harness fetches issue details using gh.
  - Given an inaccessible issue, the harness reports an actionable authentication or permission error.
priority: must
source_refs:
  - github_issue_body
tests:
  - unit
  - integration
```

### 9.2 Task Decomposition Agent

Responsibilities:

1. Split requirements into implementation tasks.
2. Identify dependencies.
3. Define parallelizable work packages.
4. Define candidate strategies.
5. Produce worker prompts.
6. Produce verifier checklist.
7. Produce expected files or subsystems to inspect.

Prompt skeleton:

```text
You are the task decomposition agent.

Input:
- requirements spec
- acceptance criteria
- repository context
- user autonomy config

Output:
- implementation task graph
- parallel worker assignments
- candidate strategy
- required verification steps
- human approval summary

Keep tasks small enough for local Aider workers.
Do not implement code.
```

### 9.3 Local Implementation Agents

Implementation agents are Aider CLI subprocesses.

Responsibilities:

1. Implement assigned work package.
2. Stay inside the assigned worktree.
3. Follow the requirement IDs.
4. Add or update tests.
5. Avoid unrelated refactors.
6. Produce an implementation summary.
7. Leave git changes uncommitted unless explicitly configured otherwise.

Aider invocation:

```bash
cd .orchestrator/worktrees/issue-123-candidate-a

aider \
  --config ../../../../.aider.conf.yml \
  --message-file ../../runs/run-issue-123/candidates/candidate-a/prompt.md
```

Worker prompt should include:

```text
You are an implementation worker called by a local Cursor harness.

You are running locally in an isolated git worktree.
Implement only the assigned requirements.
Do not create branches.
Do not create commits.
Do not open PRs.
Do not perform unrelated refactors.
Update or add tests for changed behavior.
Preserve existing project style.

Assigned requirements:
- REQ-001
- REQ-002

Acceptance criteria:
...

Verifier expectations:
...

When finished, provide:
- changed files summary
- requirement coverage notes
- tests added or updated
- known risks
```

### 9.4 Verifier Agent

Responsibilities:

1. Run required commands.
2. Inspect diffs.
3. Validate requirements coverage.
4. Check acceptance criteria.
5. Check edge cases.
6. Review tests.
7. Perform code quality review.
8. Perform security review.
9. Decide pass/fail/retry.
10. Generate feedback for implementation workers.

### 9.5 Finalization Agent

Responsibilities:

1. Select winning candidate.
2. Normalize final branch.
3. Squash or clean commits according to config.
4. Re-run final verification.
5. Create PR.
6. Link issue.
7. Attach requirement coverage report.
8. Start PR monitoring loop.

### 9.6 PR Manager / Background Reviewer

Responsibilities:

1. Poll CI status.
2. Read PR review comments.
3. Read inline comments.
4. Classify feedback:
   - required fix
   - optional suggestion
   - question
   - false positive
5. Apply clear required fixes through local worker loop.
6. Re-run verification.
7. Push updates.
8. Summarize status to user.

---

## 10. Requirement Traceability Model

Every requirement gets a stable ID.

```ts
type Requirement = {
  id: string;
  title: string;
  description: string;
  priority: "must" | "should" | "could";
  sourceRefs: SourceRef[];
  acceptanceCriteria: AcceptanceCriterion[];
  edgeCases: EdgeCase[];
  testExpectations: TestExpectation[];
  securityConsiderations: SecurityConsideration[];
};
```

Implementation candidates produce coverage records:

```ts
type RequirementCoverage = {
  requirementId: string;
  status: "covered" | "partially_covered" | "not_covered" | "not_applicable";
  evidence: EvidenceRef[];
  tests: TestEvidence[];
  notes: string;
};
```

Verifier output includes:

```yaml
coverage:
  REQ-001:
    status: covered
    evidence:
      - file: src/github/intake.ts
      - test: tests/github-intake.test.ts
  REQ-002:
    status: partially_covered
    missing:
      - inaccessible issue permission error is not tested
```

A candidate cannot pass unless every `must` requirement is covered or explicitly marked not applicable with a verifier-approved reason.

---

## 11. Verifier Design

### 11.1 Verification Pipeline

For each candidate:

1. Ensure worktree is clean enough to evaluate.
2. Capture git diff.
3. Run lint.
4. Run typecheck.
5. Run unit tests.
6. Run integration tests.
7. Run browser tests.
8. Run targeted tests related to changed files.
9. Inspect implementation against requirements.
10. Inspect edge-case handling.
11. Perform code review.
12. Perform security review.
13. Generate score and recommendation.

### 11.2 Verification Result

```ts
type VerificationResult = {
  candidateId: string;
  status: "pass" | "fail" | "retry" | "needs_human";
  scores: {
    requirements: number;
    tests: number;
    quality: number;
    security: number;
    maintainability: number;
  };
  failedCommands: CommandResult[];
  requirementCoverage: RequirementCoverage[];
  findings: Finding[];
  retryPrompt?: string;
};
```

### 11.3 Pass Criteria

A candidate passes only if:

1. All required verification commands pass.
2. All `must` requirements are covered.
3. No critical or high security findings exist.
4. No critical code review findings exist.
5. Tests cover changed behavior.
6. No unrelated changes are present.
7. Final diff is understandable and maintainable.

---

## 12. PO Acceptance Criteria Checking

The verifier includes a dedicated Product Owner acceptance pass.

It checks:

1. Does the implementation solve the user-visible problem?
2. Are all acceptance criteria satisfied?
3. Are issue comments and clarifications reflected?
4. Are edge cases handled?
5. Are user-facing behaviors documented where needed?
6. Would a reasonable product owner accept the PR?

Output:

```yaml
po_acceptance:
  status: pass
  accepted_requirements:
    - REQ-001
    - REQ-002
  concerns: []
  user_visible_summary: "The GitHub issue intake flow now accepts issue URLs and produces normalized task briefs."
```

If PO acceptance fails, the candidate loops back to implementation with product-focused feedback.

---

## 13. Tests And Edge-Case Coverage Strategy

Required test categories:

1. **Lint**: project lint command.
2. **Typecheck**: static typing command.
3. **Unit tests**: isolated behavior.
4. **Integration tests**: cross-module behavior.
5. **Browser tests**: UI and end-to-end flows when relevant.
6. **Regression tests**: for bugs described in issue.
7. **Edge-case tests**: generated from PO requirements.
8. **Smoke tests**: final quick confidence check before PR.

Edge cases should be captured during PO analysis and carried through implementation.

Example edge-case matrix:

```yaml
edge_cases:
  EDGE-001:
    requirement: REQ-001
    case: GitHub issue URL is malformed.
    expected: System returns actionable validation error.
    required_test: true

  EDGE-002:
    requirement: REQ-001
    case: GitHub CLI is not authenticated.
    expected: System tells user to run gh auth login.
    required_test: true
```

---

## 14. Security Review Strategy

Security review runs as its own verifier stage.

Checks include:

1. Secret leakage in diffs.
2. Unsafe shell execution.
3. Command injection risks.
4. Path traversal risks.
5. Insecure temp file handling.
6. Overbroad filesystem access.
7. Unsafe GitHub token handling.
8. Leaking issue or PR contents into logs unnecessarily.
9. Untrusted input handling from GitHub issue bodies/comments.
10. Dependency changes and supply-chain risk.
11. Browser test credential exposure.
12. Generated config files containing secrets.

Recommended commands:

```bash
git diff --check
git diff --cached --check
rg -n "TOKEN|SECRET|PASSWORD|PRIVATE_KEY|BEGIN RSA|BEGIN OPENSSH" .
npm audit --audit-level=high
```

The exact commands should be configurable by repo.

---

## 15. Failure And Retry Policy

### 15.1 Candidate Failure Types

```ts
type FailureKind =
  | "command_failed"
  | "requirements_missing"
  | "test_gap"
  | "security_issue"
  | "quality_issue"
  | "merge_conflict"
  | "worker_crash"
  | "ambiguous_requirement"
  | "external_blocker";
```

### 15.2 Retry Rules

Default policy:

1. Retry same candidate up to `max_attempts_per_candidate`.
2. Feed verifier findings back into the same worktree.
3. If repeated failure is architectural, spawn a new candidate with a different strategy.
4. If failure is due to ambiguity, stop for human clarification unless aggressive mode allows assumption logging.
5. If security-sensitive behavior is unclear, stop for human approval.
6. If all candidates fail, produce a failure report with best partial candidate.

### 15.3 Retry Prompt

```text
The verifier rejected your previous attempt.

Failed requirements:
- REQ-003: missing permission error handling

Failed tests:
- npm run test:integration

Security findings:
- Shell command interpolates unsanitized issue URL

Revise the implementation in this same worktree.
Do not broaden scope.
Do not remove tests to make verification pass.
Explain how each finding was addressed.
```

---

## 16. PR Creation

Finalization flow:

```bash
git checkout -b agent/issue-123/final origin/main
git merge --squash agent/issue-123/candidate-b
npm run lint
npm run typecheck
npm test
git add .
git commit -m "Implement issue 123 workflow"
git push -u origin agent/issue-123/final
gh pr create --base main --head agent/issue-123/final --title "Fix #123: <title>" --body-file .orchestrator/runs/run-issue-123/pr-body.md
```

PR body should include:

```markdown
## Summary

Closes #123.

## Requirements Coverage

- REQ-001: covered
- REQ-002: covered

## Verification

- [x] Lint
- [x] Typecheck
- [x] Unit tests
- [x] Integration tests
- [x] Browser tests
- [x] Code review
- [x] Security review
- [x] PO acceptance

## Notes

Generated by local Cursor harness using local Aider worker worktrees.
No cloud agents or cloud execution were used.
```

---

## 17. PR Monitoring Loop

After opening the PR, the background manager runs locally.

Polling commands:

```bash
gh pr checks <pr-number> --repo org/repo
gh pr view <pr-number> --repo org/repo --comments --json comments,reviews,reviewDecision,statusCheckRollup
gh api repos/org/repo/pulls/<pr-number>/comments
```

Loop behavior:

1. Poll CI until success, failure, or timeout.
2. On CI failure:
   - fetch logs where available
   - classify failure
   - patch locally if clear
   - rerun verification
   - push update
3. On review comment:
   - classify comment
   - resolve clear required changes
   - ask user for subjective/product decisions
4. On approval and green CI:
   - notify user that PR is merge-ready
5. On blocker:
   - stop and produce concise blocker report.

Config:

```yaml
pr_monitor:
  enabled: true
  poll_interval_seconds: 60
  max_duration_minutes: 240
  auto_fix_ci: true
  auto_fix_review_comments: true
  require_human_for_product_changes: true
  require_human_for_security_tradeoffs: true
```

---

## 18. State, Logging, And Artifacts

Each run writes a durable local record.

```text
.orchestrator/runs/run-issue-123/
  state.json
  events.jsonl
  task-brief.json
  requirements.md
  requirements.json
  decomposition.md
  work-packages.json
  approval.md
  candidates/
    candidate-a/
      worker-prompt.md
      aider.log
      diff.patch
      verifier-report.md
      verifier-report.json
    candidate-b/
      ...
  final/
    selected-candidate.md
    final-diff.patch
    pr-body.md
    pr-url.txt
  pr-monitor/
    checks.jsonl
    comments.jsonl
    actions.md
```

Event format:

```json
{
  "timestamp": "2026-05-08T15:00:00Z",
  "runId": "run-issue-123",
  "stage": "verification",
  "candidateId": "candidate-b",
  "event": "unit_tests_passed",
  "details": {}
}
```

Logs should redact secrets before writing.

---

## 19. CLI Surface

Recommended commands:

```bash
local-orchestrator issue org/repo#123
local-orchestrator issue org/repo#123 --autonomy conservative
local-orchestrator issue org/repo#123 --autonomy aggressive
local-orchestrator issue org/repo#123 --no-approval-gates
local-orchestrator resume run-issue-123
local-orchestrator status run-issue-123
local-orchestrator verify run-issue-123 --candidate candidate-b
local-orchestrator finalize run-issue-123 --candidate candidate-b
local-orchestrator monitor-pr <pr-url>
local-orchestrator cleanup run-issue-123
```

Autonomy modes:

```yaml
conservative:
  approval_after_requirements: true
  approval_after_decomposition: true
  approval_before_pr: true

balanced:
  approval_after_requirements: false
  approval_after_decomposition: true
  approval_before_pr: false

aggressive:
  approval_after_requirements: false
  approval_after_decomposition: false
  approval_before_pr: false
```

---

## 20. Exact Implementation Phases

### Phase 1: Local Harness Skeleton

1. Create CLI entrypoint.
2. Add run directory creation.
3. Add config loading.
4. Add event logging.
5. Add GitHub issue fetch through `gh`.
6. Normalize issue into `TaskBrief`.

Deliverable: local command can fetch an issue and create a run artifact.

### Phase 2: Product Owner And Requirements

1. Add PO prompt template.
2. Generate requirements markdown.
3. Generate structured `requirements.json`.
4. Add requirement IDs.
5. Add acceptance criteria and edge cases.
6. Add default human review prompt.

Deliverable: issue becomes approved or approvable requirements.

### Phase 3: Decomposition

1. Add decomposition prompt.
2. Produce work packages.
3. Generate candidate strategies.
4. Generate worker prompts.
5. Add decomposition approval gate.

Deliverable: approved work plan with worker-ready prompts.

### Phase 4: Worktree And Aider Worker Execution

1. Add worktree manager.
2. Add branch naming.
3. Add Aider subprocess runner.
4. Stream logs to artifacts.
5. Capture diffs.
6. Enforce local-only execution policy.

Deliverable: multiple Aider candidates can run locally in parallel worktrees.

### Phase 5: Verification Pipeline

1. Add command runner for lint/typecheck/tests.
2. Add requirement coverage checker.
3. Add PO acceptance checker.
4. Add code review pass.
5. Add security review pass.
6. Add structured verifier reports.

Deliverable: candidates receive pass/fail/retry verdicts.

### Phase 6: Retry Loop

1. Convert verifier failures into worker feedback.
2. Retry failed candidates.
3. Track attempts.
4. Spawn alternate candidates when needed.
5. Stop on ambiguity or security-sensitive uncertainty.

Deliverable: failed candidates can self-correct locally.

### Phase 7: Finalization And PR Creation

1. Select winning candidate.
2. Create final branch.
3. Apply or squash selected changes.
4. Re-run final verification.
5. Create commit.
6. Push branch.
7. Create PR with `gh`.

Deliverable: successful task produces GitHub PR.

### Phase 8: PR Monitoring

1. Poll CI.
2. Fetch review comments.
3. Classify feedback.
4. Auto-fix clear issues locally.
5. Push updates.
6. Report merge-ready or blocked state.

Deliverable: PR is monitored after open.

### Phase 9: Hardening And Customization

1. Add repo-specific config overrides.
2. Add prompt template customization.
3. Add artifact retention policy.
4. Add cleanup command.
5. Add safety checks for secrets and destructive commands.
6. Add richer dashboards or summaries.

Deliverable: production-quality local workflow.

---

## 21. Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Aider changes too much | Constrained prompts, diff review, unrelated-change verifier |
| Parallel candidates consume resources | Configurable worker limit |
| Ambiguous issues produce wrong work | PO clarification stage and approval gate |
| CI differs from local environment | PR monitor handles CI failures after open |
| Security-sensitive issue mishandled | Dedicated security review and human stop conditions |
| Worktrees become messy | State tracking and cleanup command |
| Reviewer comments require judgment | Classify subjective comments and ask user |
| Secrets leak into logs | Redaction and secret scanning |
| Bad candidate selected | Score candidates across requirements, tests, quality, security, maintainability |

---

## 22. Pros And Cons

### Pros

1. Fully local execution.
2. Cursor remains the main harness.
3. Aider is used where it is strongest: local implementation edits.
4. Parallel worktrees allow multiple solution attempts.
5. Strong verification loop improves quality.
6. Requirement traceability makes acceptance explicit.
7. GitHub PR is the natural final artifact.
8. Highly customizable through config and prompts.
9. Human gates are available without blocking aggressive autonomy.

### Cons

1. More local machine resource usage.
2. More orchestration complexity than a single-agent flow.
3. Requires careful prompt and config maintenance.
4. Local verification may not perfectly match CI.
5. Parallel worktrees can increase disk usage.
6. PR monitoring depends on GitHub CLI access and permissions.

---

## 23. Definition Of Done

The system is complete when:

1. A GitHub issue can be ingested locally.
2. Cursor harness can produce requirements and decomposition.
3. Human approval after decomposition is enabled by default.
4. Approval gates can be bypassed by config.
5. Multiple Aider workers can run locally in isolated worktrees.
6. Verifier can run lint, typecheck, unit, integration, browser, code review, security review, and PO acceptance checks.
7. Failed candidates can loop back to implementation.
8. A winning candidate can be finalized into a branch.
9. A GitHub PR can be created.
10. A local background manager can monitor CI and review comments.
11. All state, logs, prompts, diffs, and reports are persisted locally.
12. No cloud agents or cloud execution are used.
