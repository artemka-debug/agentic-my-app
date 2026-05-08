# Local Coding CLI Workers With Cursor Harness
## Implementation Plan And Specification

## 1. Executive Summary

Build a local-only agentic implementation system where **Cursor remains the controlling harness** and external coding CLIs, such as **OpenCode**, **Claude Code**, and **Amp**, are used only as local implementation engines inside isolated git worktrees.

The target workflow is:

```text
GitHub issue or user task
-> Product Owner agent clarifies requirements
-> decomposition agent writes implementation tasks
-> optional human approval gate
-> multiple local CLI worker agents implement in parallel worktrees
-> verifier agent evaluates candidates
-> failed candidates loop back
-> finalization agent selects/integrates winner
-> Cursor opens GitHub PR
-> background reviewer/manager monitors CI and PR comments
-> local fixes continue until merge-ready
```

Successful completion means a **GitHub PR** exists, has traceable requirements coverage, passes required checks, and has an active local monitoring loop for comments and CI.

No cloud execution is used. Cloud-hosted LLM APIs may be used by the CLIs if the selected worker requires them, but all repo checkout, file edits, tests, verification, worktree orchestration, and PR creation happen locally.

## 2. Goals

1. Use **Cursor as the main harness** for orchestration, user interaction, approval gates, state management, and final control.
2. Support **GitHub issue-first task intake**, with room for Linear, Notion, local markdown specs, Slack threads, or manual prompts later.
3. Run implementation work through **local CLI coding agents** in isolated worktrees.
4. Allow multiple implementation attempts in parallel.
5. Maximize quality through independent verification, test execution, code review, security review, and PO acceptance checking.
6. Preserve aggressive autonomy after task approval.
7. Allow configurable approval modes:
   - Default: human approval after decomposition.
   - Optional: fully autonomous mode after initial task submission.
8. Produce a high-quality GitHub PR as the final artifact.
9. Keep all work local and auditable.

## 3. Non-Negotiable Constraints

1. Cursor is the harness.
2. No cloud agents.
3. No cloud execution.
4. Worker tools are local CLIs only.
5. Worker tools operate inside local git worktrees.
6. GitHub PR creation is the success endpoint.
7. All requested features are in scope.
8. The system must support customization of prompts, roles, verification policy, tools, and gates.

## 4. Tool Comparison For This Architecture

### OpenCode

OpenCode is the strongest fit as the default local worker engine.

Strengths:
- Open source and highly customizable.
- Model/provider agnostic.
- Easier to wrap as a subprocess from Cursor.
- Good fit for standardized non-interactive worker runs.
- Easier to inspect, configure, and constrain.
- Lower lock-in.
- Suitable for “implementation engine as replaceable component.”

Weaknesses:
- Quality may depend heavily on chosen model/provider.
- May require more harness-side prompt discipline.
- Less vertically integrated than Claude Code.
- Some workflows may need more custom glue around session state and retries.

Best use:
- Default worker for most tasks.
- Multi-candidate fanout.
- Custom organizations that want control over models, prompts, budgets, and behavior.

### Claude Code

Claude Code is likely the highest-quality individual implementation worker, especially for complex codebase reasoning.

Strengths:
- Strong autonomous coding quality.
- Excellent long-context reasoning.
- Mature agentic behavior.
- Good fit for difficult refactors, debugging, and architecture-sensitive changes.
- Strong natural-language instruction following.

Weaknesses:
- More vendor-specific.
- Less open/customizable than OpenCode.
- Cost and subscription/API constraints may be higher.
- Harness integration may need care around session format, permissions, and deterministic invocation.

Best use:
- Premium/high-confidence worker profile.
- Complex tasks.
- Verification agent or security reviewer.
- Tie-breaker implementation attempt after OpenCode failures.

### Amp

Amp is useful as an alternate local worker, especially where speed, multi-model behavior, or Sourcegraph-style code intelligence is valuable.

Strengths:
- Local CLI workflow.
- Supports non-interactive usage.
- Multi-model orientation.
- Good for fast or deep modes depending on task.
- Useful as a diversity worker in parallel implementation races.

Weaknesses:
- Less proven as the primary harness-controlled implementation engine than Claude Code/OpenCode.
- May expose more product-specific workflow assumptions.
- Thread/share features are less important here because Cursor owns orchestration state.

Best use:
- Secondary implementation candidate.
- Fast exploratory implementation.
- Deep-mode attempt for hard issues.
- Codebase-wide reasoning worker where Amp performs well.

## 5. Recommended Variant

Use a **hybrid worker pool** with **OpenCode as the default implementation engine**, plus optional Claude Code and Amp profiles.

Recommended default:

```yaml
default_worker: opencode
worker_pool:
  - id: opencode-default
    engine: opencode
    role: implementation
  - id: claude-code-premium
    engine: claude-code
    role: implementation
    enabled_for: complex_or_high_risk
  - id: amp-diversity
    engine: amp
    role: implementation
    enabled_for: parallel_fanout
```

Why:
- OpenCode gives the best harness-controlled, customizable foundation.
- Claude Code gives a high-quality premium path.
- Amp adds diversity and speed.
- Cursor remains the stateful orchestrator, not the worker CLI.

## 6. High-Level Architecture

```text
Cursor Harness
  |
  |-- Intake Manager
  |     |-- GitHub Issue Reader
  |     |-- Manual Task Input
  |     |-- Future Source Adapters
  |
  |-- Product Owner Agent
  |     |-- Clarifying Questions
  |     |-- Requirements
  |     |-- Acceptance Criteria
  |
  |-- Decomposition Agent
  |     |-- Task DAG
  |     |-- Risk Tags
  |     |-- Test Expectations
  |
  |-- Approval Controller
  |     |-- Manual Gate
  |     |-- Autonomous Mode
  |
  |-- Worktree Orchestrator
  |     |-- Candidate Worktree A
  |     |-- Candidate Worktree B
  |     |-- Candidate Worktree C
  |
  |-- Local Worker Adapter Layer
  |     |-- OpenCode Adapter
  |     |-- Claude Code Adapter
  |     |-- Amp Adapter
  |
  |-- Verifier Agent
  |     |-- Lint
  |     |-- Typecheck
  |     |-- Unit Tests
  |     |-- Integration Tests
  |     |-- Browser Tests
  |     |-- Requirements Coverage
  |     |-- Code Review
  |     |-- Security Review
  |
  |-- Selection And Finalization Agent
  |     |-- Candidate Ranking
  |     |-- Merge/Cherry-pick
  |     |-- Final Test Run
  |     |-- PR Body Generation
  |
  |-- GitHub PR Manager
        |-- PR Creation
        |-- CI Monitoring
        |-- Review Comment Triage
        |-- Local Fix Loop
```

## 7. How Cursor Remains The Harness

Cursor owns:

1. User-facing workflow.
2. Approval gates.
3. Prompt templates.
4. Requirements state.
5. Decomposition state.
6. Worktree lifecycle.
7. Worker process spawning.
8. Artifact collection.
9. Candidate scoring.
10. Verification policy.
11. Final PR creation.
12. PR comment and CI monitoring.
13. All cross-agent memory and traceability.

Worker CLIs do not decide the global workflow. They receive bounded implementation prompts and operate only within their assigned worktree.

Cursor should invoke workers as subprocesses through shell commands, hooks, or task runners, but the task graph, state machine, and final decisions remain in Cursor.

## 8. Cursor Features To Use

### Modes

Define harness operating modes:

```yaml
modes:
  planning:
    description: PO and decomposition only
    write_access: false

  approved_autonomy:
    description: implementation may proceed after task approval
    write_access: true
    approval_required_after_decomposition: true

  full_autonomy:
    description: no mandatory gates after initial user task
    write_access: true
    approval_required_after_decomposition: false

  verification_only:
    description: run verifier against existing branch or PR
    write_access: false_or_patch_only
```

### Hooks

Use Cursor hooks for lifecycle automation:

```text
on_task_started
on_requirements_written
on_decomposition_ready
on_approval_granted
on_worker_started
on_worker_completed
on_verification_failed
on_candidate_selected
on_pr_created
on_ci_failed
on_review_comment_received
on_task_completed
```

Hook examples:
- Initialize run directory.
- Create worktrees.
- Start worker commands.
- Collect logs.
- Trigger verification.
- Notify user when approval is needed.
- Monitor PR state after creation.

### Subagents

Use Cursor subagents for harness-native roles:

1. Product Owner agent.
2. Decomposition agent.
3. Verifier agent.
4. Code reviewer agent.
5. Security reviewer agent.
6. Finalization agent.
7. PR manager agent.

External CLIs are not harness subagents. They are worker processes launched by the harness.

### Plugins / MCP

Use MCP or CLI integrations for:

1. GitHub issue reading.
2. GitHub PR creation.
3. CI status checks.
4. Review comments.
5. Browser testing.
6. Optional future sources like Linear, Notion, Jira, Slack, or local docs.

## 9. GitHub Issue Intake

### Supported Inputs

Initial scope:

```text
agentic-task start --issue owner/repo#123
agentic-task start --issue https://github.com/owner/repo/issues/123
agentic-task start --prompt "Implement ..."
agentic-task start --spec ./specs/task.md
```

Future adapters:

```text
agentic-task start --linear ABC-123
agentic-task start --notion <page-url>
agentic-task start --jira PROJ-123
agentic-task start --slack <thread-url>
```

### GitHub Issue Intake Steps

1. Fetch issue title, body, labels, comments, assignees, milestone, linked PRs.
2. Detect repository and default branch.
3. Pull latest default branch locally.
4. Extract initial problem statement.
5. Identify ambiguity and missing acceptance criteria.
6. Ask clarifying questions if required.
7. Produce formal requirements document.
8. Link requirement IDs back to source issue fragments.

### Issue Intake Artifact

```yaml
source:
  type: github_issue
  repo: owner/repo
  issue_number: 123
  url: https://github.com/owner/repo/issues/123

summary: "Short problem summary"

stakeholders:
  requester: "@user"
  reviewers: []

labels:
  - bug
  - frontend

source_fragments:
  - id: SRC-001
    kind: issue_body
    quote: "..."
  - id: SRC-002
    kind: issue_comment
    author: "@reviewer"
    quote: "..."
```

## 10. Product Owner Agent

### Responsibilities

1. Convert raw issue/user task into requirements.
2. Identify ambiguity.
3. Ask clarifying questions.
4. Define acceptance criteria.
5. Define non-functional requirements.
6. Define edge cases.
7. Define expected tests.
8. Define explicit out-of-bounds only if the user permits. For this system spec, all requested features remain in scope.
9. Produce traceable requirement IDs.

### PO Prompt Template

```text
You are the Product Owner agent.

Your job is to transform the user task or GitHub issue into a complete, testable implementation specification.

You must:
- Preserve user intent.
- Identify ambiguity.
- Ask clarifying questions when needed.
- Produce requirements with stable IDs.
- Produce acceptance criteria.
- Produce edge cases.
- Produce expected verification evidence.
- Avoid implementation details unless required for acceptance.
- Mark every requirement as must/should/could.
- Link requirements to source fragments.

Output:
1. Problem summary
2. Requirements
3. Acceptance criteria
4. Edge cases
5. Non-functional requirements
6. Test expectations
7. Open questions
8. Approval recommendation
```

### PO Output Example

```yaml
requirements:
  - id: REQ-001
    priority: must
    source_refs: [SRC-001]
    statement: "The system must allow GitHub issue URLs as task input."
    acceptance:
      - id: AC-001
        statement: "Given a GitHub issue URL, the harness fetches title, body, comments, labels, and metadata."
    verification:
      - type: integration_test
      - type: manual_review
```

## 11. Decomposition Agent

### Responsibilities

1. Split requirements into implementation tasks.
2. Identify dependencies.
3. Assign risk level.
4. Define worker prompts.
5. Define candidate strategy.
6. Define test strategy.
7. Decide whether fanout is useful.
8. Produce task DAG.

### Decomposition Output

```yaml
tasks:
  - id: TASK-001
    title: "Implement GitHub issue intake"
    requirement_refs: [REQ-001, REQ-002]
    depends_on: []
    risk: medium
    suggested_workers:
      - opencode-default
      - claude-code-premium
    expected_files:
      - src/intake/github.ts
    verification:
      - unit
      - integration

  - id: TASK-002
    title: "Implement requirements traceability model"
    requirement_refs: [REQ-003]
    depends_on: [TASK-001]
    risk: high
    suggested_workers:
      - opencode-default
      - amp-diversity
```

### Decomposition Approval

Default behavior:
- Pause after decomposition.
- Show requirements, task DAG, risks, proposed fanout, and estimated test cost.
- Ask user to approve, revise, or switch to full autonomy.

Configurable behavior:
- `approval.after_decomposition: required`
- `approval.after_decomposition: skip`
- `approval.after_decomposition: required_for_high_risk_only`

## 12. Local Worker Spawning

### Worker Contract

Each worker receives:

1. Repository path.
2. Worktree path.
3. Base branch.
4. Task spec.
5. Requirement IDs.
6. Acceptance criteria.
7. Constraints.
8. Files likely relevant.
9. Allowed commands.
10. Forbidden actions.
11. Expected final response format.
12. Timeout and retry policy.

Each worker must produce:

1. Git diff.
2. Summary.
3. Requirement coverage notes.
4. Tests run.
5. Known risks.
6. Self-review.
7. Final status.

### Worktree Layout

```text
.repo/
.worktrees/
  run-2026-05-08-1855/
    candidate-opencode-001/
    candidate-claude-001/
    candidate-amp-001/

.agent-runs/
  run-2026-05-08-1855/
    state.yaml
    requirements.yaml
    decomposition.yaml
    workers/
      opencode-001/
        prompt.md
        stdout.log
        stderr.log
        result.yaml
        diff.patch
      claude-001/
      amp-001/
    verification/
      lint.log
      typecheck.log
      unit.log
      integration.log
      browser.log
      code-review.md
      security-review.md
      coverage.yaml
    final/
      selected-candidate.yaml
      pr-body.md
```

### Generic Worker Command

```bash
agentic-task worker run \
  --engine opencode \
  --run-id run-2026-05-08-1855 \
  --candidate-id opencode-001 \
  --worktree .worktrees/run-2026-05-08-1855/candidate-opencode-001 \
  --task .agent-runs/run-2026-05-08-1855/decomposition.yaml \
  --requirements .agent-runs/run-2026-05-08-1855/requirements.yaml
```

### OpenCode Adapter

Example command shape:

```bash
cd "$WORKTREE" && opencode run --prompt-file "$PROMPT_FILE"
```

Adapter responsibilities:
- Generate prompt file.
- Set working directory.
- Apply timeout.
- Capture stdout/stderr.
- Collect diff.
- Normalize result into `worker-result.yaml`.

### Claude Code Adapter

Example command shape:

```bash
cd "$WORKTREE" && claude --print "$(cat "$PROMPT_FILE")"
```

Adapter responsibilities:
- Run in non-interactive mode where available.
- Enforce local worktree boundary.
- Capture session output.
- Extract final summary and test commands.
- Collect diff.

### Amp Adapter

Example command shape:

```bash
cd "$WORKTREE" && amp -x "$(cat "$PROMPT_FILE")"
```

Adapter responsibilities:
- Select `rush`, `smart`, or `deep` profile.
- Capture output.
- Normalize artifacts.
- Collect diff.

## 13. Worker Prompt Template

```text
You are a local implementation worker running inside an isolated git worktree.

Cursor is the controlling harness. You are not the orchestrator.

Repository:
{repo}

Worktree:
{worktree}

Task:
{task_title}

Requirements:
{requirements}

Acceptance Criteria:
{acceptance_criteria}

Constraints:
- Do not modify files outside this worktree.
- Do not push.
- Do not create PRs.
- Do not change unrelated code.
- Do not skip tests silently.
- Preserve existing user changes.
- Follow repository conventions.
- Prefer minimal, high-quality changes.
- Add or update tests appropriate to risk.
- Document any commands that could not be run.

Expected output:
1. Summary
2. Requirement coverage by ID
3. Files changed
4. Tests run
5. Known risks
6. Suggested verifier focus
7. Final status: success, partial, or failed
```

## 14. Worktree Fanout Strategy

### Candidate Modes

```yaml
fanout:
  disabled:
    candidates: 1

  conservative:
    candidates: 2
    engines: [opencode, claude-code]

  balanced:
    candidates: 3
    engines: [opencode, claude-code, amp]

  aggressive:
    candidates: 5
    engines:
      - opencode
      - opencode
      - claude-code
      - amp
      - claude-code
```

### When To Fan Out

Fanout is recommended for:
- High ambiguity.
- Complex refactors.
- UI changes.
- Security-sensitive changes.
- Failing bug reproduction.
- Performance-sensitive code.
- Large cross-cutting tasks.

Fanout can be skipped for:
- Tiny mechanical changes.
- Documentation-only tasks.
- Simple dependency bumps.
- Single-file low-risk fixes.

### Candidate Selection Criteria

Score each candidate on:

```yaml
candidate_score:
  requirements_coverage: 0.30
  test_success: 0.25
  code_quality: 0.20
  maintainability: 0.10
  security: 0.10
  diff_minimality: 0.05
```

## 15. Requirement Traceability Model

### Core Entities

```yaml
Requirement:
  id: REQ-001
  statement: string
  priority: must | should | could
  source_refs: [SRC-001]
  acceptance_criteria: [AC-001]
  verification_methods: [unit, integration, browser, review]

AcceptanceCriterion:
  id: AC-001
  requirement_ref: REQ-001
  statement: string
  testable: true
  verification_status: pending | passed | failed | waived

ImplementationTask:
  id: TASK-001
  requirement_refs: [REQ-001]
  worker_candidates: [opencode-001]

VerificationResult:
  requirement_ref: REQ-001
  acceptance_ref: AC-001
  status: passed | failed | partial | not_applicable
  evidence:
    - command: npm test
      result: passed
    - review_note: "..."
```

### Coverage Matrix

The verifier produces:

```yaml
coverage:
  REQ-001:
    status: passed
    acceptance:
      AC-001:
        status: passed
        evidence:
          - type: integration_test
            artifact: verification/integration.log

  REQ-002:
    status: failed
    acceptance:
      AC-002:
        status: failed
        reason: "No test covers malformed issue URLs."
```

A PR cannot be finalized unless all `must` requirements are passed or explicitly waived by policy.

## 16. Verifier Design

The verifier is independent from implementation workers.

### Verifier Responsibilities

1. Inspect diff.
2. Check requirement coverage.
3. Run required commands.
4. Run code review.
5. Run security review.
6. Run edge-case review.
7. Compare candidates.
8. Decide pass/fail/retry.
9. Produce actionable feedback for workers.

### Verification Pipeline

```text
static inspection
-> dependency/install sanity
-> lint
-> typecheck
-> unit tests
-> integration tests
-> browser tests
-> requirements coverage
-> PO acceptance check
-> code review
-> security review
-> candidate scoring
```

### Command Discovery

Verifier should infer commands from:
- `package.json`
- `Makefile`
- `justfile`
- `pyproject.toml`
- `Cargo.toml`
- `go.mod`
- existing CI config
- repo docs
- prior successful run metadata

Example:

```yaml
verification_commands:
  lint:
    command: npm run lint
    required: true
  typecheck:
    command: npm run typecheck
    required: true
  unit:
    command: npm test
    required: true
  integration:
    command: npm run test:integration
    required: false
  browser:
    command: npm run test:e2e
    required: conditional
```

## 17. PO Acceptance Criteria Checking

The PO acceptance checker answers:

1. Did the implementation solve the user-visible problem?
2. Does each acceptance criterion have evidence?
3. Were edge cases handled?
4. Were non-functional requirements honored?
5. Did the implementation introduce behavior outside the approved spec?
6. Is the PR body honest about limitations?

PO check output:

```yaml
po_acceptance:
  overall: passed
  requirements:
    - id: REQ-001
      status: passed
      evidence: "Integration test validates GitHub issue URL intake."
    - id: REQ-002
      status: partial
      reason: "Malformed issue URL handling exists but lacks a unit test."
      required_action: "Add unit test before PR."
```

## 18. Test And Edge-Case Coverage Strategy

### Test Types

1. Lint.
2. Typecheck.
3. Unit tests.
4. Integration tests.
5. Browser/e2e tests.
6. Snapshot or golden tests where appropriate.
7. Regression tests for bugs.
8. Security-focused tests for risky input paths.
9. Manual verification notes when automation is impossible.

### Edge-Case Policy

The PO agent defines expected edge cases. The verifier checks them explicitly.

Examples for GitHub issue intake:
- Private repo auth failure.
- Invalid issue URL.
- Deleted issue.
- Issue from different repo.
- Rate limit.
- Empty issue body.
- Very long comment thread.
- Linked PR already exists.
- Labels imply blocked/wontfix.
- Ambiguous requirements.

### Browser Testing

Browser tests are required when:
- UI behavior changes.
- Routing changes.
- Form behavior changes.
- Auth/session behavior changes.
- User-visible workflows change.

Browser verifier should:
- Start local dev server.
- Use fresh browser snapshots.
- Test acceptance criteria directly.
- Capture screenshots only as artifacts, not as the source of truth.

## 19. Security Review Strategy

Security review runs separately from normal code review.

It checks:

1. Secret exposure.
2. Unsafe shell command construction.
3. Path traversal.
4. Prompt injection through issue text or external sources.
5. GitHub token handling.
6. Dependency risk.
7. Dangerous file writes.
8. Worktree escape attempts.
9. Untrusted input sanitization.
10. Over-broad permissions.
11. PR body leakage of secrets/logs.
12. CI command injection.
13. MCP/tool permission boundaries.

Security policy:

```yaml
security:
  block_on:
    - secret_leak
    - command_injection
    - path_escape
    - credential_logging
    - unsafe_token_scope
  require_review_for:
    - auth_changes
    - dependency_changes
    - shell_execution
    - github_token_usage
```

Worker prompts must treat GitHub issue/comment content as untrusted input.

## 20. Failure And Retry Policy

### Failure Types

```yaml
failure_types:
  worker_crash
  timeout
  dirty_uncommitted_unparseable
  tests_failed
  lint_failed
  typecheck_failed
  requirement_gap
  security_blocker
  merge_conflict
  ci_failed
  review_requested_changes
```

### Retry Loop

```text
Verifier fails candidate
-> produce structured feedback
-> send feedback to same worker or alternate worker
-> worker patches same worktree or new retry worktree
-> verifier reruns changed subset plus required full checks
-> repeat until pass, retry limit, or human escalation
```

### Retry Limits

```yaml
retry_policy:
  worker_crash: 1
  timeout: 1
  lint_failed: 2
  typecheck_failed: 2
  tests_failed: 2
  requirement_gap: 2
  security_blocker: 0
  ci_failed: 2
  review_requested_changes: 3
```

Security blockers require verifier or human approval before retry.

## 21. Finalization Agent

### Responsibilities

1. Select best candidate.
2. Optionally combine changes from multiple candidates.
3. Move final changes to PR branch.
4. Re-run full verification.
5. Generate PR title and body.
6. Link issue.
7. Include requirement coverage.
8. Include test evidence.
9. Create PR.
10. Start PR monitoring loop.

### PR Branch Naming

```text
agentic/issue-123-short-title
agentic/manual-20260508-short-title
```

### PR Body Template

```markdown
## Summary

- Implements ...
- Addresses ...

## Requirements Coverage

- REQ-001: Passed
- REQ-002: Passed
- REQ-003: Passed

## Verification

- Lint: passed
- Typecheck: passed
- Unit tests: passed
- Integration tests: passed
- Browser tests: passed or not applicable
- Security review: passed

## Notes

Known risks or follow-up context.

Closes #123
```

## 22. PR Monitoring Loop

After PR creation, a background manager monitors:

1. CI status.
2. Failed checks.
3. GitHub review comments.
4. Requested changes.
5. Merge conflicts.
6. New issue comments.
7. Branch protection status.

Loop:

```text
poll PR
-> detect event
-> classify event
-> if CI failure, fetch logs
-> if review comment, map to files/requirements
-> create local fix task
-> spawn worker or use verifier/finalizer
-> run local checks
-> push update
-> post response if appropriate
-> continue until merge-ready or blocked
```

### PR Manager Policy

```yaml
pr_monitor:
  enabled: true
  poll_interval_seconds: 120
  max_runtime_hours: 8
  auto_fix:
    ci_failures: true
    review_comments: true
    merge_conflicts: true
  require_human_for:
    - ambiguous_review_feedback
    - security_sensitive_change
    - public_api_change
    - destructive_migration
```

## 23. State, Logging, And Artifacts

### Run State

```yaml
run:
  id: run-2026-05-08-1855
  status: verifying
  source:
    type: github_issue
    url: https://github.com/owner/repo/issues/123
  base_branch: main
  pr_branch: agentic/issue-123-title
  approval_mode: approved_autonomy
  created_at: 2026-05-08T18:55:00+03:00
```

### Required Artifacts

1. Raw source intake.
2. Requirements document.
3. Decomposition document.
4. Approval record.
5. Worker prompts.
6. Worker logs.
7. Worker diffs.
8. Verification logs.
9. Coverage matrix.
10. Security review.
11. Code review.
12. Candidate scorecard.
13. Final PR body.
14. PR monitor event log.

### Logging Requirements

Logs must be:
- Local.
- Timestamped.
- Associated with run ID.
- Safe to share after redaction.
- Redacted for tokens, secrets, and credentials.
- Linked from final summary.

## 24. Configuration Schema

```yaml
version: 1

harness:
  name: cursor-local-workers
  approval_mode: approved_autonomy
  default_source: github_issue

github:
  default_remote: origin
  default_base_branch: main
  pr_draft: false
  auto_link_issues: true
  monitor_after_open: true

workers:
  default_engine: opencode
  max_parallel: 3
  timeout_minutes: 45
  engines:
    opencode:
      enabled: true
      command: opencode
      args: ["run", "--prompt-file", "{prompt_file}"]

    claude_code:
      enabled: true
      command: claude
      args: ["--print", "{prompt}"]

    amp:
      enabled: true
      command: amp
      args: ["-x", "{prompt}"]
      mode: smart

fanout:
  default: balanced
  candidates:
    balanced:
      - engine: opencode
      - engine: claude_code
      - engine: amp

approval:
  after_requirements: optional
  after_decomposition: required
  before_pr_creation: optional
  allow_full_autonomy: true

verification:
  required:
    - lint
    - typecheck
    - unit
    - code_review
    - security_review
    - requirements_coverage
  conditional:
    browser: ui_changes
    integration: integration_surface_changes
  block_on_security_findings: true
  require_all_must_requirements: true

retry:
  max_total_rounds: 3
  max_worker_retries: 2
  allow_alternate_worker_on_failure: true

artifacts:
  directory: .agent-runs
  keep_worker_logs: true
  redact_secrets: true
```

## 25. CLI Commands

### Start From GitHub Issue

```bash
agentic-task start --issue owner/repo#123
```

### Start From Manual Prompt

```bash
agentic-task start --prompt "Implement support for local worker fanout"
```

### Plan Only

```bash
agentic-task plan --issue owner/repo#123
```

### Approve Decomposition

```bash
agentic-task approve --run run-2026-05-08-1855
```

### Run Fully Autonomous

```bash
agentic-task start --issue owner/repo#123 --autonomy full
```

### Run Candidate Workers

```bash
agentic-task workers spawn --run run-2026-05-08-1855 --fanout balanced
```

### Verify Candidates

```bash
agentic-task verify --run run-2026-05-08-1855
```

### Finalize PR

```bash
agentic-task finalize --run run-2026-05-08-1855 --create-pr
```

### Monitor PR

```bash
agentic-task monitor-pr --pr owner/repo#456
```

### Resume Run

```bash
agentic-task resume --run run-2026-05-08-1855
```

## 26. UX Flow

### Default Human-Gated Flow

```text
User: "Work on issue #123"

Cursor:
1. Fetches issue.
2. PO agent writes requirements.
3. Decomposition agent writes task plan.
4. Cursor shows:
   - requirements
   - acceptance criteria
   - task DAG
   - proposed workers
   - verification plan
5. User approves.
6. Cursor creates worktrees.
7. Cursor spawns local worker CLIs.
8. Cursor verifies candidates.
9. Cursor loops failures back.
10. Cursor selects final candidate.
11. Cursor creates PR.
12. Cursor monitors PR comments and CI.
```

### Full Autonomy Flow

```text
User: "Work on issue #123 with full autonomy"

Cursor:
1. Fetches issue.
2. Writes requirements.
3. Decomposes.
4. Proceeds without mandatory approval.
5. Implements through local workers.
6. Verifies.
7. Creates PR.
8. Monitors and fixes PR.
9. Reports final merge-ready state or blocker.
```

### User Controls

The user can:
- Approve.
- Reject.
- Edit requirements.
- Edit decomposition.
- Switch worker profile.
- Increase/decrease fanout.
- Pause run.
- Resume run.
- Force verifier rerun.
- Create draft PR.
- Stop PR monitoring.

## 27. Exact Implementation Phases

### Phase 1: Harness Skeleton

Build:
- Run state model.
- Local artifact directory.
- Config loading.
- GitHub issue intake.
- Manual prompt intake.
- Basic CLI command surface.

Deliverable:
- `agentic-task start --issue ...` creates a run with source metadata.

### Phase 2: Requirements And Decomposition

Build:
- PO prompt.
- Requirements schema.
- Acceptance criteria schema.
- Decomposition schema.
- Human approval gate.
- Rendered plan summary in Cursor.

Deliverable:
- GitHub issue becomes approved implementation plan.

### Phase 3: Worktree Orchestration

Build:
- Worktree creation.
- Branch naming.
- Candidate directories.
- Cleanup/resume logic.
- Worker prompt materialization.

Deliverable:
- A run can create isolated worktrees for N candidates.

### Phase 4: Worker Adapter Layer

Build:
- OpenCode adapter.
- Claude Code adapter.
- Amp adapter.
- Common worker result parser.
- Log capture.
- Diff capture.
- Timeout handling.

Deliverable:
- Cursor can spawn any configured local CLI worker inside a worktree.

### Phase 5: Verification Pipeline

Build:
- Command discovery.
- Lint/typecheck/unit runner.
- Integration/browser test hooks.
- Code review agent.
- Security review agent.
- Requirements coverage checker.
- Candidate scoring.

Deliverable:
- Candidate receives pass/fail score with actionable feedback.

### Phase 6: Retry Loop

Build:
- Structured verifier feedback.
- Same-worker retry.
- Alternate-worker retry.
- Retry limits.
- Failure classification.
- Human escalation.

Deliverable:
- Failed candidates can be repaired automatically.

### Phase 7: Finalization And PR Creation

Build:
- Candidate selection.
- Final branch creation.
- Patch/cherry-pick strategy.
- Final verification.
- PR body generation.
- `gh pr create` integration.

Deliverable:
- Successful run opens a GitHub PR.

### Phase 8: PR Monitoring Manager

Build:
- CI polling.
- Review comment polling.
- CI log retrieval.
- Comment classification.
- Local fix task generation.
- Push updates.
- PR event log.

Deliverable:
- Cursor keeps PR merge-ready after opening.

### Phase 9: Customization And Profiles

Build:
- Worker profiles.
- Verification profiles.
- Autonomy profiles.
- Prompt overrides.
- Repo-specific config.
- Per-label policy mapping.

Deliverable:
- Teams can tune quality, cost, autonomy, and risk behavior.

### Phase 10: Hardening

Build:
- Secret redaction.
- Permission checks.
- Worktree escape detection.
- Crash recovery.
- Resume support.
- Artifact retention policy.
- Cross-platform support.

Deliverable:
- Reliable local system suitable for daily use.

## 28. Risks And Mitigations

### Risk: Worker CLIs Behave Inconsistently

Mitigation:
- Use strict prompts.
- Normalize outputs.
- Capture diffs, not just summaries.
- Verify independently.
- Prefer artifact-based state over conversational state.

### Risk: Parallel Candidates Waste Cost

Mitigation:
- Configurable fanout.
- Use fanout only for riskier tasks.
- Add cheap first-pass planning.
- Use OpenCode or faster Amp modes for lower-risk work.

### Risk: Worker Escapes Scope

Mitigation:
- Worktree isolation.
- Prompt constraints.
- Diff inspection.
- Path allow/deny rules.
- Security review.
- No direct push permission for workers.

### Risk: Bad PR Despite Passing Tests

Mitigation:
- PO acceptance check.
- Independent code review.
- Security review.
- Requirement coverage matrix.
- Human approval before PR for high-risk changes.

### Risk: GitHub Issue Contains Prompt Injection

Mitigation:
- Treat issue text as untrusted.
- PO agent extracts requirements instead of obeying raw issue instructions.
- Worker prompt separates source text from harness instructions.
- Security review checks prompt injection paths.

### Risk: CI Differs From Local

Mitigation:
- Mirror CI commands from workflow files.
- Monitor PR after open.
- Fetch CI logs.
- Auto-fix failures locally.
- Keep PR manager active.

### Risk: Merge Conflicts During Long Runs

Mitigation:
- Rebase before final verification.
- Detect conflicts in PR monitor.
- Spawn local conflict-resolution task.
- Re-run full verifier after conflict resolution.

## 29. Pros And Cons

### Pros

- Fully local execution.
- Cursor remains the primary control plane.
- Flexible worker choice.
- Strong quality gates.
- Easy to customize prompts and policies.
- Parallel implementation improves odds of good solutions.
- GitHub PR is a concrete success artifact.
- Traceability improves trust and review quality.
- PR monitoring closes the loop after initial implementation.

### Cons

- More orchestration complexity than a single agent.
- Requires careful config per repository.
- Parallel workers may increase model/API costs.
- CLI behavior may change across versions.
- Local machine resources may bottleneck parallel tests.
- Browser/integration tests can be flaky.
- Requires strong log redaction discipline.

## 30. Final Recommendation

Implement the system as a **Cursor-controlled local orchestration harness** with a replaceable worker adapter layer.

Use:

```yaml
primary_worker: OpenCode
premium_worker: Claude Code
diversity_worker: Amp
default_approval: after_decomposition
default_fanout: balanced
success_artifact: GitHub PR
execution_location: local_only
```

This gives the user the desired combination: Cursor as the main harness, aggressive local autonomy, high customizability, parallel implementation quality, independent verification, and a clean GitHub PR as the final deliverable.
