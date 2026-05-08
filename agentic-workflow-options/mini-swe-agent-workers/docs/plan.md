## Specification: Local SWE-Style Issue-Solving Workers With Cursor Harness

### Summary
Build a local-only agentic implementation system where Cursor is the primary harness, control surface, approval point, and source of truth for work orchestration. GitHub issues are the first-class task source. The system turns an approved issue into requirements, decomposes it into implementation tasks, fans out multiple local workers across isolated git worktrees, verifies candidates against requirements and quality gates, selects or iterates on the best result, opens a GitHub PR, and monitors PR comments and CI until merge-ready.

No cloud agents or cloud execution are used. mini-SWE-agent or SWE-agent may be used only as local worker executables inside local worktrees or local sandboxes.

## Goals
- Implement GitHub issues end-to-end into reviewable PRs.
- Keep Cursor as the main harness for orchestration, visibility, approvals, prompts, logs, review, and final handoff.
- Support aggressive autonomy after task approval, with configurable human gates.
- Maximize quality through parallel local candidates, strict verification, code review, security review, browser testing, and PO acceptance coverage.
- Preserve customizability through role prompts, worker backends, verification profiles, retry policies, sandbox strategies, and PR templates.
- Keep the architecture future-ready for other task sources such as Linear, Notion, local specs, Slack threads, or manual prompts.

## Non-Goals
- No cloud agent execution.
- No replacement of Cursor as the primary harness.
- No requirement that mini-SWE-agent or SWE-agent be the only worker backend; they are optional local executors.
- No automatic merge by default, though the system may prepare a PR until it is merge-ready.

## Architecture

The system has one local orchestrator controlled from Cursor.

Core components:

- `Cursor Harness`: the user-facing control plane inside Cursor. It owns task approval, decomposition review, run visibility, logs, artifacts, diffs, final summaries, and manual override.
- `Local Orchestrator CLI`: a local command run from Cursor. It manages issue intake, state, agents, worktrees, verification, retries, PR creation, and PR monitoring.
- `Task Source Adapter`: initially GitHub Issues. Later adapters can implement the same task intake interface.
- `Product Owner Agent`: clarifies the user request, transforms issue context into requirements, acceptance criteria, assumptions, and open questions.
- `Task Decomposition Agent`: converts approved requirements into implementation tasks with dependencies, touched areas, test expectations, and verification mapping.
- `Implementation Worker Pool`: launches multiple local workers in parallel worktrees. Each worker may use Cursor local agent execution, mini-SWE-agent, SWE-agent, or a configured local command.
- `Verifier Agent`: runs deterministic checks, semantic review, requirements coverage, edge-case analysis, test review, security review, browser validation, and candidate scoring.
- `Finalization Agent`: integrates the selected candidate, normalizes commits, prepares PR body, links requirements, and opens the PR.
- `PR Manager Agent`: monitors CI, PR comments, requested changes, and reviewer feedback locally after PR creation, then loops fixes through local workers.

## Local Execution And Sandbox Strategy
All execution happens on the user’s machine.

The orchestrator creates a run directory:

```text
.agentic-runs/
  <run-id>/
    state.json
    requirements.md
    decomposition.md
    artifacts/
    logs/
    worktrees/
      candidate-a/
      candidate-b/
      candidate-c/
    verification/
    final/
```

Each implementation candidate runs in a separate git worktree from the same base commit:

```text
repo/
repo/.agentic-runs/<run-id>/worktrees/candidate-a
repo/.agentic-runs/<run-id>/worktrees/candidate-b
```

Sandbox options:

- `worktree`: default. Fast, uses git isolation.
- `worktree+denylist`: blocks writes outside the worktree and run artifact directory.
- `container-local`: optional Docker/Podman local sandbox, still no cloud execution.
- `nix/devcontainer-local`: optional reproducible local environment if the repo already supports it.
- `readonly-analysis`: for PO, decomposition, verifier review, and security agents when they do not need writes.

Network policy is configurable:

- Default implementation workers may access only configured package registries and GitHub.
- Verifiers may access local app URLs and GitHub PR APIs.
- No external LLM/cloud execution endpoints are used.

Secrets policy:

- Workers receive only explicit env allowlists.
- Secrets are never copied into run artifacts.
- Logs redact configured patterns.
- PR bodies never include secrets or full environment dumps.

## How Cursor Remains The Main Harness
Cursor remains the main harness in five ways:

1. The user starts and supervises runs from Cursor.
2. All prompts, role definitions, config, state summaries, artifacts, and diffs are opened or surfaced in Cursor.
3. Human approval gates happen in Cursor before decomposition execution by default.
4. The orchestrator can call local worker commands, but Cursor owns the top-level workflow and final decision surface.
5. The successful outcome is a PR created from a Cursor-approved local candidate.

mini-SWE-agent/SWE-agent are subordinate worker engines, not the harness. They receive bounded task packets and operate only inside assigned local worktrees.

## GitHub Issue Intake And PR Creation
GitHub issue intake supports:

- `owner/repo#number`
- full GitHub issue URL
- current repo issue number
- manual task text with optional GitHub issue link

The intake adapter fetches:

- issue title/body/comments/labels/assignees/milestone
- linked PRs
- referenced files or stack traces
- existing discussion decisions
- repository metadata and default branch
- CI requirements from GitHub checks and local config

The finalization agent creates a PR with:

- title derived from the issue and actual implemented behavior
- body containing summary, linked issue, requirements coverage, tests run, security notes, known risks, and screenshots/videos when available
- branch naming such as `agentic/issue-123-short-slug`
- optional draft mode until all required checks pass
- labels/reviewers/projects copied or inferred from config

Successful task definition: a GitHub PR exists, contains the selected implementation, links back to the issue, includes verification artifacts, and is ready for human review or merge according to configured policy.

## Agent Roles And Prompt Contracts

### Product Owner Agent
Purpose: convert task input into an implementable specification.

Inputs:

- GitHub issue context
- repo context summary
- prior related issues/PRs if available
- user-provided constraints

Outputs:

- problem statement
- user value
- requirements
- acceptance criteria
- non-functional requirements
- edge cases
- ambiguity list
- assumptions
- requirement IDs

Prompt skeleton:

```text
You are the Product Owner agent. Transform the task into precise requirements.
Do not implement. Identify ambiguity, ask clarifying questions when blocking,
and produce acceptance criteria that can be verified by tests or review.
Every requirement must have a stable ID.
```

### Task Decomposition Agent
Purpose: split the approved requirements into executable implementation tasks.

Outputs:

- task graph
- suggested touched areas
- dependency ordering
- test obligations
- risk level per task
- worker assignment hints
- requirement coverage mapping

Prompt skeleton:

```text
You are the decomposition agent. Convert approved requirements into local
implementation tasks. Preserve traceability to requirement IDs. Prefer small,
reviewable units. Include tests, docs, migration, and verification expectations.
```

### Implementation Agent
Purpose: implement one candidate solution in a local worktree.

Inputs:

- task packet
- requirements
- repo conventions
- verification profile
- allowed files or ownership hints
- base branch and worktree path

Outputs:

- code changes
- tests
- implementation notes
- requirement coverage self-report
- known limitations

Prompt skeleton:

```text
You are a local implementation worker running inside an isolated worktree.
Implement the assigned task completely. Follow repository conventions.
Add or update tests proportional to risk. Do not change files outside scope
unless required. Return a concise implementation summary and requirement map.
```

### Verifier Agent
Purpose: judge candidate correctness and quality.

Outputs:

- pass/fail
- score
- blocking findings
- non-blocking findings
- test results
- requirements coverage matrix
- security findings
- review comments
- retry instructions

Prompt skeleton:

```text
You are the verifier. Evaluate this candidate against requirements, tests,
edge cases, code quality, maintainability, and security. Be skeptical.
Fail candidates with missing acceptance criteria, broken tests, risky behavior,
unreviewed security implications, or inadequate coverage.
```

### Finalization Agent
Purpose: prepare selected work for PR.

Outputs:

- final branch
- cleaned commits
- PR title/body
- verification summary
- artifacts attached or linked
- reviewer notes

Prompt skeleton:

```text
You are the finalization agent. Prepare the selected candidate for PR.
Preserve implementation intent, include verification evidence, link issue and
requirements, and produce a clear reviewer-facing description.
```

### PR Manager Agent
Purpose: keep the PR merge-ready.

Inputs:

- PR comments
- review comments
- CI failures
- GitHub checks
- local logs

Outputs:

- classified feedback
- fix tasks
- local worker reruns
- responses to comments
- updated PR status summary

Prompt skeleton:

```text
You are the PR manager. Monitor the opened PR. Classify CI failures and review
comments. For clear actionable fixes, create local fix tasks and run them
through the same verifier. Do not dismiss human feedback. Escalate ambiguity.
```

## Requirement Traceability Model
Every requirement gets a stable ID:

```text
REQ-001: User can import a GitHub issue by URL.
REQ-002: Decomposition requires human approval by default.
SEC-001: Secrets must not be written to logs.
NFR-001: All execution is local.
```

Traceability entities:

- `Requirement`: ID, source, priority, acceptance criteria, verification method.
- `Task`: ID, requirement IDs, dependencies, assigned workers, status.
- `Candidate`: worker ID, worktree, changed files, commits, self-reported coverage.
- `VerificationResult`: requirement ID, status, evidence, failing checks.
- `PRArtifact`: PR URL, branch, commits, coverage summary.

Coverage statuses:

- `covered-by-test`
- `covered-by-review`
- `covered-by-browser-test`
- `covered-by-security-review`
- `not-covered`
- `blocked`
- `not-applicable-with-reason`

A candidate cannot pass final verification while any required acceptance criterion is `not-covered` or `blocked`.

## Verifier Design
Verification has deterministic and agentic layers.

Deterministic checks:

- format
- lint
- typecheck
- unit tests
- integration tests
- browser/end-to-end tests
- build
- dependency audit if configured
- migration checks if configured
- changed-file policy checks
- secret scanning
- license/dependency policy checks

Agentic checks:

- code review
- PO requirements coverage
- edge-case review
- security review
- maintainability review
- test quality review
- regression risk review
- PR readiness review

Candidate scoring:

- correctness
- requirement coverage
- test strength
- simplicity
- maintainability
- security posture
- blast radius
- consistency with repo patterns
- reviewability

A candidate passes only if all required gates pass. Scores are used to select among passing candidates or prioritize retry feedback.

## PO Acceptance Criteria Checking
The PO agent’s acceptance criteria are transformed into a checklist with verification methods.

Example:

```text
REQ-004
Acceptance: User can run `agentic issue start owner/repo#123`.
Verification: CLI smoke test plus mocked GitHub adapter test.
Evidence: test name, command output, verifier note.
```

The verifier must answer for each criterion:

- What code implements this?
- What test or review evidence proves it?
- What edge cases were considered?
- What remains unproven?
- Is the behavior user-visible and documented if needed?

If acceptance criteria are ambiguous, the candidate fails with a clarification request unless config allows assumption-based continuation.

## Test And Edge-Case Coverage Strategy
Each task packet includes expected test layers.

Required test categories:

- unit tests for pure logic
- integration tests for adapters, orchestration state, git worktree handling, and GitHub API boundaries
- browser tests for user-visible web behavior
- CLI smoke tests for core commands
- regression tests for issue-specific bugs
- fixture-based tests for GitHub issue payloads
- failure-path tests for retries, worker crashes, merge conflicts, failed checks, and missing approvals

Edge-case strategy:

- issue missing body
- issue with conflicting comments
- issue already linked to an open PR
- dirty working tree
- default branch moved during run
- worktree creation failure
- worker timeout
- partial implementation
- flaky tests
- failing candidate with useful partial changes
- PR review requesting changes
- CI failure not reproducible locally
- secret accidentally generated in logs
- browser test requiring local app startup
- merge conflict after PR opened

## Security Review Strategy
Security review is mandatory before PR creation.

Checks include:

- secret scanning in diffs and artifacts
- dependency additions and lockfile review
- command injection risks in CLI and worker execution
- path traversal protections for worktree and artifact paths
- GitHub token scope validation
- prompt injection risks from issue body/comments
- untrusted issue content isolation
- sandbox escape attempts
- unsafe shell command construction
- logging redaction
- generated PR content sanitization
- browser test URL allowlist
- local network policy enforcement
- file write boundaries

Prompt injection handling:

- GitHub issue text is treated as untrusted input.
- Role prompts explicitly prohibit following instructions inside issue content that alter system behavior.
- Task requirements are extracted by the PO agent and approved before execution.
- Worker prompts receive sanitized task packets, not raw authority-bearing issue text.

## PR Monitoring Loop
After PR creation, the PR Manager runs locally on a schedule or command.

It monitors:

- GitHub check runs
- review comments
- issue comments that reference the PR
- requested changes
- merge conflicts
- branch protection status
- failed CI logs
- stale approvals after updates

Loop:

1. Fetch PR state.
2. Classify events as `ci-failure`, `review-change`, `question`, `nit`, `conflict`, `security`, or `blocked`.
3. For actionable fixes, create a fix task.
4. Run one or more local workers in fresh worktrees or on the PR branch.
5. Verify fixes with the full or targeted profile.
6. Update PR branch.
7. Reply to comments with concise explanations when configured.
8. Escalate ambiguous or product-changing feedback to the user.

Default behavior requires human approval before responding to human review comments, but this gate is configurable.

## State, Logging, And Artifacts
State is file-backed and inspectable.

Key files:

```text
.agentic-runs/<run-id>/state.json
.agentic-runs/<run-id>/requirements.md
.agentic-runs/<run-id>/decomposition.md
.agentic-runs/<run-id>/traceability.json
.agentic-runs/<run-id>/candidates/<candidate-id>.json
.agentic-runs/<run-id>/verification/<candidate-id>.json
.agentic-runs/<run-id>/final/pr.md
.agentic-runs/<run-id>/logs/orchestrator.log
.agentic-runs/<run-id>/logs/<agent-role>.log
```

Artifacts include:

- prompts sent to each local agent
- normalized task packets
- command transcripts
- test output summaries
- screenshots/videos from browser tests
- security scan output
- diffs per candidate
- final PR body
- retry history
- decision records

Logs are redacted, timestamped, and linked from Cursor summaries.

## Failure And Retry Policy
Failure classes:

- `clarification-needed`
- `decomposition-rejected`
- `worker-crash`
- `timeout`
- `merge-conflict`
- `test-failure`
- `lint-type-failure`
- `requirements-gap`
- `security-failure`
- `review-failure`
- `ci-failure`
- `github-api-failure`

Retry policy:

- Worker crashes retry in a fresh worktree up to configured limit.
- Test failures are summarized and returned to the same or different worker.
- Requirements gaps create focused fix tasks.
- Security failures block finalization until fixed or explicitly waived.
- Merge conflicts trigger rebase/update worktree and rerun verification.
- Flaky tests require rerun quorum before classification.
- Repeated failure escalates to user with artifacts and recommended next action.

Default candidate loop:

```text
implement -> verify -> fail feedback -> reimplement/fix -> verify -> select -> finalize
```

## Configuration Schema
Example local config:

```yaml
version: 1

execution:
  mode: local-only
  harness: cursor
  sandbox: worktree
  max_parallel_workers: 4
  default_timeout_minutes: 45
  allow_cloud_execution: false

sources:
  github:
    enabled: true
    default_repo: owner/repo
    token_env: GITHUB_TOKEN

gates:
  require_approval_after_requirements: true
  require_approval_after_decomposition: true
  allow_no_gate_mode: true
  require_approval_before_pr: false
  require_approval_before_review_replies: true

workers:
  backends:
    - id: cursor-local
      command: cursor-agent-local
    - id: mini-swe-agent
      command: mini-swe-agent run
      enabled: true
    - id: swe-agent
      command: swe-agent run
      enabled: false
  selection_strategy: diverse-parallel

verification:
  required:
    - lint
    - typecheck
    - unit
    - integration
    - browser
    - code_review
    - security_review
    - po_acceptance
  commands:
    lint: npm run lint
    typecheck: npm run typecheck
    unit: npm test
    integration: npm run test:integration
    browser: npm run test:e2e

security:
  secret_scan: true
  dependency_audit: true
  github_token_min_scope: true
  redact_patterns:
    - "ghp_[A-Za-z0-9_]+"
    - "sk-[A-Za-z0-9]+"

github:
  pr:
    draft_until_verified: true
    branch_prefix: agentic/
    labels:
      - agentic
    reviewers: []
    auto_link_issue: true

monitoring:
  enabled: true
  interval_seconds: 120
  fix_clear_ci_failures: true
  respond_to_comments: approval-required
```

## CLI Commands
Primary commands:

```bash
agentic init
agentic issue intake owner/repo#123
agentic issue start owner/repo#123
agentic requirements approve <run-id>
agentic decompose <run-id>
agentic decompose approve <run-id>
agentic fanout <run-id> --workers 4
agentic verify <run-id>
agentic select <run-id> --candidate candidate-b
agentic finalize <run-id>
agentic pr create <run-id>
agentic pr monitor <pr-url>
agentic status <run-id>
agentic logs <run-id>
agentic artifact open <run-id> requirements
agentic retry <run-id> --candidate candidate-a --reason requirements-gap
agentic run owner/repo#123 --no-mandatory-gates
```

One-shot default:

```bash
agentic issue start owner/repo#123
```

Aggressive autonomy:

```bash
agentic run owner/repo#123 --approve-after decomposition --auto-pr
```

Fully autonomous local mode:

```bash
agentic run owner/repo#123 --no-mandatory-gates --auto-pr --monitor-pr
```

## UX Flow
Default UX:

1. User provides GitHub issue or task in Cursor.
2. Orchestrator fetches issue context.
3. PO agent writes requirements and acceptance criteria.
4. Cursor shows requirements for approval or clarification.
5. Decomposition agent creates implementation task graph.
6. Cursor shows decomposition for approval by default.
7. Orchestrator creates parallel worktrees.
8. Local implementation workers run.
9. Verifier evaluates all candidates.
10. Failed candidates loop back with targeted feedback.
11. Best passing candidate is selected.
12. Finalization agent prepares PR branch and body.
13. PR is opened on GitHub.
14. PR Manager monitors CI and comments.
15. Clear fixes loop back through local implementation and verification.
16. Ambiguous/product-changing feedback escalates to user.

No-gate UX:

1. User runs with `--no-mandatory-gates`.
2. PO and decomposition proceed using configured assumptions.
3. Workers, verifier, finalization, PR creation, and monitoring run autonomously.
4. User receives a PR plus verification summary and risk notes.

## Rollout Plan
Phase 1: Local Orchestrator Foundation

- Create run directory model.
- Implement state machine.
- Add config loading and validation.
- Add git worktree creation and cleanup.
- Add Cursor-facing status summaries.
- Add local command execution with timeouts and logs.

Phase 2: GitHub Issue Intake

- Implement GitHub issue adapter.
- Fetch issue body, comments, labels, linked PRs, and metadata.
- Add token scope checks.
- Normalize issue context into task source packets.
- Add manual task input adapter as a future-source baseline.

Phase 3: PO Requirements Agent

- Add PO prompt template.
- Generate requirement IDs and acceptance criteria.
- Add clarification handling.
- Add approval gate.
- Persist `requirements.md` and `traceability.json`.

Phase 4: Decomposition Agent

- Generate task graph.
- Map tasks to requirements.
- Add risk scoring and test expectations.
- Add approval gate.
- Persist `decomposition.md`.

Phase 5: Local Worker Fanout

- Implement worktree fanout.
- Add worker backend interface.
- Add Cursor local worker backend.
- Add mini-SWE-agent local backend.
- Add SWE-agent local backend.
- Capture diffs, commits, logs, and self-reports.

Phase 6: Verification Engine

- Add deterministic command runner.
- Add lint/typecheck/unit/integration/browser profiles.
- Add verifier agent review.
- Add PO acceptance coverage matrix.
- Add candidate scoring and pass/fail policy.

Phase 7: Retry Loop

- Feed verifier findings back into workers.
- Add retry limits and failure classes.
- Support same-worker and fresh-worker retries.
- Add flaky test handling.
- Add conflict recovery.

Phase 8: Security Review

- Add secret scan.
- Add dependency audit hooks.
- Add prompt-injection hardening.
- Add command/path safety review.
- Add security verifier prompt and blocking policy.

Phase 9: Finalization And PR Creation

- Select winning candidate.
- Prepare final branch.
- Generate PR title/body.
- Link issue and artifacts.
- Create draft or ready PR through GitHub.
- Record PR artifact.

Phase 10: PR Monitoring Manager

- Poll checks, comments, and review state.
- Classify feedback.
- Trigger local fix loops.
- Push updates.
- Escalate ambiguous review comments.
- Maintain merge-ready status.

Phase 11: UX Polish And Extensibility

- Add richer Cursor summaries.
- Add artifact open commands.
- Add source adapter interface for Linear/Notion/local specs.
- Add profile presets.
- Add cleanup and archival commands.
- Add documentation and examples.

## Risks And Mitigations
- Risk: Local workers damage user files. Mitigation: isolated worktrees, path allowlists, dirty-tree checks, no destructive git commands, artifact boundaries.
- Risk: Issue text prompt-injects agents. Mitigation: treat issue content as untrusted, sanitize into approved requirements, harden prompts.
- Risk: Parallel workers waste time or create noisy solutions. Mitigation: bounded worker count, candidate scoring, focused task packets.
- Risk: Verifier misses product intent. Mitigation: stable requirement IDs, PO acceptance matrix, human approval gates by default.
- Risk: CI differs from local. Mitigation: PR Manager watches CI, reproduces locally when possible, loops fixes.
- Risk: Security regressions from autonomous changes. Mitigation: mandatory security review and blocking secret/dependency checks.
- Risk: Over-automation frustrates reviewers. Mitigation: approval-required review replies by default, clear PR summaries, small scoped branches.
- Risk: Long-running local jobs consume resources. Mitigation: concurrency limits, timeouts, cancellation, resumable state.
- Risk: Worktree conflicts after base branch changes. Mitigation: base refresh, rebase strategy, rerun verification.
- Risk: Poor customization. Mitigation: explicit config schema for prompts, commands, gates, workers, verification, and monitoring.

## Pros And Cons
Pros:

- Fully local execution preserves control and avoids cloud execution.
- Cursor remains the central harness and decision surface.
- Parallel worktrees improve solution quality through candidate diversity.
- Requirement traceability makes verification concrete.
- PR monitoring closes the loop after PR creation.
- Highly customizable prompts, gates, worker backends, and checks.

Cons:

- Requires local machine resources for parallel workers and tests.
- More orchestration complexity than a single-agent workflow.
- Browser and integration tests may need project-specific setup.
- Quality depends on strong repo-specific verification commands.
- Local-only constraint limits elastic scaling.

## Acceptance Criteria For This System
The system is complete when:

- A user can run a GitHub issue through PO requirements, decomposition, local worker fanout, verification, finalization, and PR creation.
- Cursor remains the primary harness throughout the workflow.
- All implementation execution happens locally.
- mini-SWE-agent/SWE-agent run only as local worker backends inside isolated worktrees or local sandboxes.
- Human approval after decomposition is enabled by default.
- No-mandatory-gates mode is available.
- Verification includes lint, typecheck, unit, integration, browser tests, code review, security review, and PO acceptance coverage.
- Failed candidates loop back to implementation workers with actionable verifier feedback.
- The final output is a GitHub PR with linked issue, tests run, requirements coverage, and risk notes.
- A local PR Manager can monitor comments and CI, trigger fixes, and keep the PR merge-ready.
