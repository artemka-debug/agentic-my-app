## Cursor-Native Local Agentic Workflow Spec

### Summary

Build a fully local, Cursor-native implementation workflow where GitHub issues become pull requests through a configurable multi-agent pipeline:

`GitHub issue or task input -> Product Owner spec -> decomposition -> parallel worktree implementations -> verification and review -> finalist PR -> background PR manager`

Cursor remains the main harness. Execution happens locally through Cursor Skills, Rules, Hooks, worktrees, `/best-of-n`, local shell commands, local browser verification, and GitHub CLI/API. No Cursor Cloud Agents or cloud execution are used.

The successful output for a task is a GitHub PR with traceable requirements, verification evidence, review notes, and ongoing CI/comment monitoring.

---

## 1. Goals

### Primary Goals

- Implement tasks from GitHub issues first, while allowing future task sources such as Notion, Linear, local markdown specs, Slack summaries, or direct user prompts.
- Keep all execution local inside Cursor.
- Use Cursor as the orchestration surface for planning, implementation, verification, browser testing, PR creation, and PR follow-up.
- Maximize quality through parallel candidate implementations, independent verification, code review, security review, and Product Owner acceptance checks.
- Support aggressive autonomy after task approval.
- Require human approval after decomposition by default, with config options to disable mandatory gates.
- Produce a GitHub PR as the canonical success artifact.
- Preserve full traceability from original issue requirements to code changes, tests, verification logs, review findings, and PR description.
- Make the workflow highly customizable through local config, Skills, Rules, Hooks, prompts, and command templates.

### Secondary Goals

- Keep the system understandable and debuggable.
- Allow partial reruns, retries, and candidate repair loops.
- Keep artifacts local and easy to inspect.
- Support both small single-agent fixes and large multi-agent best-of-N tasks.
- Provide clear operator controls for autonomy, verification strictness, and PR monitoring behavior.

### Non-Goals

These do not exclude any requested feature:

- Do not require a hosted control plane.
- Do not require Cursor Cloud Agents.
- Do not require a separate SaaS workflow manager.
- Do not replace GitHub as the PR and review surface.

---

## 2. System Architecture

### High-Level Components

1. **Cursor Main Harness**
   - The user-facing orchestration point.
   - Runs the workflow through Cursor chat, commands, Skills, Rules, Hooks, local shell, local browser tooling, and local files.
   - Owns state transitions and human approval checkpoints.

2. **Task Intake Layer**
   - Starts with GitHub issues.
   - Fetches issue title, body, labels, comments, linked PRs, acceptance criteria, screenshots, and related files.
   - Normalizes the issue into a local task packet.
   - Future-compatible with other task sources.

3. **Product Owner Agent**
   - Converts raw task input into clarified requirements.
   - Identifies ambiguity, constraints, users, acceptance criteria, risks, and success definition.
   - Produces a requirements/spec artifact.
   - Can ask the human clarifying questions before implementation.

4. **Task Decomposition Agent**
   - Splits the approved spec into implementation tasks.
   - Defines candidate strategy, likely files, test expectations, verification matrix, and acceptance mapping.
   - Produces the decomposition artifact and implementation briefs.
   - Human approval happens here by default.

5. **Parallel Implementation Agents**
   - Multiple local agents run in separate git worktrees.
   - Each receives the same approved spec plus an implementation brief.
   - Agents may use different strategies, prompts, model choices, or constraints.
   - Candidates produce code, tests, notes, and local verification evidence.

6. **Verifier Agent**
   - Runs local lint, typecheck, unit tests, integration tests, browser tests, and task-specific checks.
   - Checks edge cases, regression risk, quality, maintainability, and requirements coverage.
   - Performs separate code review and security review.
   - Rejects, repairs, or ranks candidates.

7. **Repair Loop**
   - Failed candidates are sent back to their implementer worktree with precise verifier findings.
   - Candidate can retry until configured limits are reached.
   - The verifier re-runs relevant checks after repair.

8. **Finalization Agent**
   - Selects or merges the best candidate.
   - Creates the final branch.
   - Produces PR title, body, test plan, requirement traceability, and implementation summary.
   - Opens the GitHub PR locally using `gh`.

9. **Background PR Reviewer / Manager**
   - Monitors PR comments, review threads, check runs, and CI failures.
   - Applies clear fixes locally when allowed.
   - Re-runs verification.
   - Updates the PR and reports ambiguous decisions back to the user.

---

## 3. Local Execution Model

### Execution Principles

- All agents run locally in Cursor.
- All shell commands run locally.
- All browser verification runs locally against local dev servers or configured preview URLs.
- Git operations happen locally.
- GitHub interaction happens through `gh` or GitHub API using local credentials.
- No cloud-hosted agent execution.
- No remote workspaces.
- No Cursor Cloud Agents.

### Local Runtime Surfaces

- Cursor chat commands.
- Cursor Skills.
- Cursor Rules.
- Cursor Hooks.
- Cursor local terminal.
- Cursor local browser verification tooling.
- Git worktrees.
- `/best-of-n` for parallel attempts where available.
- `gh` CLI for GitHub issue and PR workflows.
- Local artifact files in the repository or a configured workflow state directory.

### Required Local Tools

- `git`
- `gh`
- Project package manager, for example `npm`, `pnpm`, `yarn`, `bun`, `pip`, `uv`, `cargo`, `go`, or `maven`
- Local browser tooling supported by Cursor
- Optional project-specific tools:
  - Playwright
  - Cypress
  - Storybook
  - Docker Compose
  - database migration tooling
  - security scanners
  - dependency audit tools

---

## 4. Agent Roles

### 4.1 Workflow Orchestrator

Responsible for:

- Starting and resuming workflows.
- Loading configuration.
- Creating state directories.
- Invoking agents in order.
- Enforcing gates.
- Routing failed candidates back to implementers.
- Tracking artifacts.
- Producing final status.

Inputs:

- GitHub issue URL/number or direct task text.
- Workflow config.
- Current repository state.

Outputs:

- Workflow state log.
- Agent instructions.
- Final PR URL.

---

### 4.2 GitHub Intake Agent

Responsible for:

- Fetching issue content with `gh issue view`.
- Reading comments with `gh api` or `gh issue view --comments`.
- Capturing labels, assignees, milestone, project metadata, linked issues, and linked PRs.
- Detecting whether the issue already has implementation attempts.
- Producing normalized task intake.

Commands:

```bash
gh issue view <issue> --json title,body,labels,assignees,milestone,comments,url,state
gh api repos/<owner>/<repo>/issues/<number>/comments
```

Output artifact:

```text
.agent-workflows/<task-id>/intake.md
.agent-workflows/<task-id>/intake.json
```

---

### 4.3 Product Owner Agent

Responsible for:

- Clarifying user intent.
- Turning issue content into a spec.
- Identifying ambiguous requirements.
- Extracting or proposing acceptance criteria.
- Defining user-visible behavior.
- Capturing constraints and non-functional requirements.
- Producing requirement IDs.

Output artifact:

```text
.agent-workflows/<task-id>/requirements.md
.agent-workflows/<task-id>/requirements.json
```

Requirement format:

```json
{
  "id": "REQ-001",
  "title": "Short requirement name",
  "description": "Detailed expected behavior",
  "source": "GitHub issue #123 body/comment URL",
  "priority": "must|should|could",
  "acceptanceCriteria": [
    "Observable condition that must be true"
  ],
  "verificationMethods": [
    "unit",
    "integration",
    "browser",
    "manual-review",
    "security-review"
  ],
  "status": "pending|covered|failed|waived"
}
```

---

### 4.4 Task Decomposition Agent

Responsible for:

- Breaking requirements into implementation tasks.
- Identifying likely code areas.
- Defining test work.
- Defining candidate strategies.
- Producing implementer briefs.
- Producing verifier checklist.
- Asking for human approval by default.

Output artifacts:

```text
.agent-workflows/<task-id>/decomposition.md
.agent-workflows/<task-id>/implementation-briefs/candidate-a.md
.agent-workflows/<task-id>/implementation-briefs/candidate-b.md
.agent-workflows/<task-id>/verification-plan.md
```

Default gate:

```yaml
gates:
  requireApprovalAfterDecomposition: true
```

Configurable no-gate mode:

```yaml
gates:
  requireApprovalAfterDecomposition: false
```

---

### 4.5 Implementation Agents

Responsible for:

- Working in isolated local worktrees.
- Implementing the task.
- Adding or updating tests.
- Running lightweight local validation.
- Producing implementation notes.
- Avoiding unrelated refactors.
- Preserving user changes.

Each candidate receives:

- Original intake.
- Approved requirements.
- Decomposition.
- Candidate-specific brief.
- Repository rules.
- Verification commands.
- Traceability requirements.

Output artifacts:

```text
.agent-workflows/<task-id>/candidates/<candidate-id>/summary.md
.agent-workflows/<task-id>/candidates/<candidate-id>/changed-files.txt
.agent-workflows/<task-id>/candidates/<candidate-id>/self-check.md
.agent-workflows/<task-id>/candidates/<candidate-id>/verification.log
```

---

### 4.6 Verifier Agent

Responsible for:

- Checking each candidate independently.
- Running configured commands.
- Reviewing code quality.
- Reviewing security.
- Checking PO requirements coverage.
- Checking edge cases.
- Ranking candidates.
- Producing rejection or repair instructions.

Output artifacts:

```text
.agent-workflows/<task-id>/verification/<candidate-id>.md
.agent-workflows/<task-id>/verification/coverage-matrix.md
.agent-workflows/<task-id>/verification/ranking.md
.agent-workflows/<task-id>/verification/final-recommendation.md
```

Candidate states:

```text
created -> implemented -> verifying -> accepted
created -> implemented -> verifying -> repair-needed -> implemented
created -> implemented -> verifying -> rejected
```

---

### 4.7 Finalization Agent

Responsible for:

- Selecting the winning candidate.
- Moving final changes onto a PR branch.
- Ensuring final verification passes.
- Creating a PR.
- Writing PR title/body.
- Linking the GitHub issue.
- Including requirement traceability and test evidence.
- Updating local workflow state.

Commands:

```bash
git checkout -b <pr-branch>
git merge --squash <candidate-branch>
git commit -m "<message>"
git push -u origin HEAD
gh pr create --title "<title>" --body-file <body-file>
```

PR body must include:

- Summary.
- Linked issue.
- Requirements covered.
- Test plan.
- Verification evidence.
- Risks.
- Screenshots or browser notes if relevant.
- Security review summary.
- Follow-up items only if genuinely non-blocking.

---

### 4.8 PR Reviewer / Manager Agent

Responsible for:

- Monitoring PR comments.
- Monitoring GitHub review threads.
- Monitoring CI/check runs.
- Applying clear fixes locally.
- Asking user for judgment on ambiguous product or architecture decisions.
- Pushing follow-up commits.
- Updating PR comments when resolved.

Commands:

```bash
gh pr view <pr> --json title,body,state,reviewDecision,comments,reviews,latestReviews,headRefName,statusCheckRollup
gh pr checks <pr>
gh api repos/<owner>/<repo>/pulls/<number>/comments
gh api repos/<owner>/<repo>/issues/<number>/comments
```

Loop interval:

```yaml
prMonitor:
  enabled: true
  intervalSeconds: 120
  maxDurationMinutes: 240
  autoFixClearFailures: true
  requireApprovalForBehaviorChanges: true
```

---

## 5. Skills, Rules, Hooks, and Prompts Inventory

### Cursor Skills

Create the following local Skills:

1. `github-issue-intake`
   - Fetches and normalizes GitHub issue data.
   - Produces intake artifacts.

2. `po-spec-writer`
   - Converts task input into requirements.
   - Produces requirement IDs and acceptance criteria.

3. `task-decomposer`
   - Splits requirements into implementation tasks.
   - Produces candidate briefs and verification plan.

4. `local-worktree-implementer`
   - Implements a candidate in a local git worktree.
   - Follows repository rules and candidate brief.

5. `candidate-verifier`
   - Runs local validation and reviews candidate quality.
   - Produces coverage matrix and findings.

6. `po-acceptance-checker`
   - Verifies implementation against PO requirements.
   - Uses requirement IDs as the source of truth.

7. `security-reviewer`
   - Reviews auth, data exposure, input validation, secrets, dependency risk, and permission boundaries.

8. `browser-verifier`
   - Runs local browser checks.
   - Captures screenshots or notes when relevant.

9. `pr-finalizer`
   - Creates branch, commit, PR body, and PR.

10. `pr-monitor-manager`
   - Watches PR comments and CI.
   - Applies clear fixes or escalates ambiguity.

---

### Cursor Rules

Create project rules for:

1. `workflow-local-only`
   - Prohibits Cursor Cloud Agents and cloud execution.
   - Requires local shell, local browser, local worktrees.

2. `github-task-success-definition`
   - Defines success as an opened GitHub PR.

3. `requirements-traceability`
   - Requires every material change to map to one or more requirement IDs.

4. `implementation-agent-behavior`
   - Defines local coding behavior, scope control, testing expectations, and no unrelated refactors.

5. `verifier-agent-behavior`
   - Defines verification duties and rejection standards.

6. `security-review-behavior`
   - Defines security checklist and escalation rules.

7. `pr-monitor-behavior`
   - Defines post-PR monitoring loop and fix policy.

8. `human-approval-gates`
   - Defines default approval after decomposition and configurable bypass.

---

### Cursor Hooks

Create hooks for:

1. `on-workflow-start`
   - Validate repo state.
   - Check `gh auth status`.
   - Check clean or approved dirty working tree.
   - Create state directory.

2. `after-intake`
   - Save normalized task packet.
   - Link source issue.

3. `after-po-spec`
   - Validate requirements have IDs, priority, acceptance criteria, source, and verification method.

4. `after-decomposition`
   - Pause for approval unless disabled.

5. `before-implementation-agent`
   - Create candidate worktree.
   - Write candidate brief.
   - Confirm branch naming.

6. `after-implementation-agent`
   - Capture changed files.
   - Capture self-check.
   - Run quick validation if configured.

7. `before-verification`
   - Ensure candidate artifacts exist.
   - Ensure required commands are configured.

8. `after-verification`
   - Update candidate state.
   - Trigger repair loop or finalist selection.

9. `before-pr-create`
   - Ensure final verification passed.
   - Ensure requirement coverage matrix has no unapproved failures.
   - Ensure no secrets are staged.

10. `after-pr-create`
   - Save PR URL.
   - Start PR monitor if enabled.

11. `on-pr-comment-or-ci-failure`
   - Classify incoming feedback.
   - Auto-fix clear issues if configured.
   - Escalate ambiguous issues.

---

## 6. Worktree Strategy

### Worktree Layout

```text
.repo/
  main working tree

../.agent-worktrees/
  <repo-name>-<task-id>-candidate-a/
  <repo-name>-<task-id>-candidate-b/
  <repo-name>-<task-id>-candidate-c/
```

Alternative in-repo state only:

```text
.agent-workflows/<task-id>/
  state.json
  intake.md
  requirements.md
  decomposition.md
  candidates/
  verification/
  pr/
```

### Branch Naming

```text
agent/<issue-number>-<slug>/candidate-a
agent/<issue-number>-<slug>/candidate-b
agent/<issue-number>-<slug>/candidate-c
agent/<issue-number>-<slug>/final
```

### Candidate Count

Configurable:

```yaml
implementation:
  strategy: best-of-n
  candidateCount: 3
  maxRepairAttemptsPerCandidate: 2
```

### Candidate Diversity

Candidate prompts should vary along configurable axes:

- Minimal targeted fix.
- Broader architectural cleanup within scope.
- Test-first implementation.
- UX/browser-focused implementation.
- Performance-focused implementation.
- Security-focused implementation.

### Worktree Cleanup

Configurable:

```yaml
worktrees:
  cleanupRejected: false
  cleanupAfterPrMerge: true
  preserveWinningCandidate: true
```

Rejected candidates should usually be preserved until the PR is merged, because they contain useful comparison data.

---

## 7. GitHub Issue Intake and PR Creation

### Intake Flow

1. User provides:
   - GitHub issue URL.
   - Issue number.
   - Or direct task text.

2. Intake agent resolves repository and issue.

3. Intake agent fetches:
   - Title.
   - Body.
   - Comments.
   - Labels.
   - Assignees.
   - Milestone.
   - Linked resources.
   - Existing related PRs.

4. Intake agent writes normalized task packet.

5. Product Owner agent drafts requirements.

6. If ambiguity blocks implementation, ask user questions.

### PR Creation Flow

1. Final candidate selected.
2. Final branch created.
3. Final verification run.
4. Requirement coverage confirmed.
5. PR body generated.
6. Branch pushed.
7. PR opened with `gh pr create`.
8. PR URL saved.
9. PR monitor starts.

### PR Template

```markdown
## Summary

<Concise implementation summary>

Closes #<issue-number>

## Requirements Coverage

- REQ-001: Covered by <files/tests/verification>
- REQ-002: Covered by <files/tests/verification>

## Verification

- Lint: <pass/fail/waived>
- Typecheck: <pass/fail/waived>
- Unit tests: <pass/fail/waived>
- Integration tests: <pass/fail/waived>
- Browser verification: <pass/fail/waived>
- Security review: <pass/fail/waived>
- PO acceptance check: <pass/fail/waived>

## Test Plan

<Commands and manual/browser steps>

## Risks

<Known risks and mitigations>

## Artifacts

<Local artifact references or summarized evidence>
```

---

## 8. Requirement Traceability Model

### Requirement IDs

Every requirement receives a stable ID:

```text
REQ-001
REQ-002
REQ-003
```

### Traceability Matrix

Each requirement maps to:

- Source.
- Acceptance criteria.
- Implementation files.
- Tests.
- Verification methods.
- Candidate status.
- Final status.
- Waiver, if any.

Example:

```json
{
  "requirementId": "REQ-001",
  "source": "https://github.com/org/repo/issues/123#issue-...",
  "implementationFiles": [
    "src/example.ts"
  ],
  "tests": [
    "tests/example.test.ts"
  ],
  "verification": {
    "unit": "pass",
    "integration": "pass",
    "browser": "not-applicable",
    "security": "pass",
    "poAcceptance": "pass"
  },
  "status": "covered",
  "notes": "Implemented through validation path and covered by regression test."
}
```

### Required Traceability Gates

Before PR creation:

- Every `must` requirement must be `covered` or explicitly `waived`.
- Waivers require reason and user approval unless no-gate mode allows agent-approved waivers.
- Every code change must map to at least one requirement, test need, or cleanup necessary for the requirement.
- PR body must summarize requirement coverage.

---

## 9. Verifier Design

### Verifier Inputs

- Requirements.
- Decomposition.
- Candidate diff.
- Candidate self-check.
- Project verification config.
- Repository rules.
- Security checklist.
- Browser test plan.

### Verifier Stages

1. **Static inspection**
   - Diff review.
   - Scope control.
   - Architecture fit.
   - Maintainability.
   - Error handling.
   - Dependency changes.

2. **Local command verification**
   - Lint.
   - Typecheck.
   - Unit tests.
   - Integration tests.
   - Build.
   - Project-specific commands.

3. **Browser verification**
   - Start local dev server if needed.
   - Navigate through changed flows.
   - Check acceptance criteria.
   - Capture screenshots or notes.
   - Inspect console errors and failed network requests.

4. **PO acceptance check**
   - Requirement-by-requirement assessment.
   - User-visible behavior validation.
   - Edge-case validation.

5. **Security review**
   - Auth and authorization.
   - Input validation.
   - Data exposure.
   - Secret leakage.
   - Injection risk.
   - Dependency and supply-chain risk.
   - File-system and shell safety.
   - Logging of sensitive data.

6. **Candidate ranking**
   - Requirements coverage.
   - Test strength.
   - Simplicity.
   - Maintainability.
   - Risk.
   - User experience.
   - Security posture.
   - Regression risk.

### Verifier Result Schema

```json
{
  "candidateId": "candidate-a",
  "status": "accepted|repair-needed|rejected",
  "score": 87,
  "requirements": {
    "REQ-001": "pass",
    "REQ-002": "fail"
  },
  "commands": [
    {
      "name": "typecheck",
      "command": "pnpm typecheck",
      "status": "pass",
      "log": "verification/typecheck.log"
    }
  ],
  "findings": [
    {
      "severity": "blocking|major|minor|nit",
      "requirementId": "REQ-002",
      "message": "Missing empty-state handling.",
      "repairInstruction": "Add empty-state branch and browser test."
    }
  ],
  "security": {
    "status": "pass|fail|needs-review",
    "findings": []
  },
  "recommendation": "repair"
}
```

---

## 10. PO Acceptance Criteria Checking

### PO Checker Responsibilities

- Treat requirements as the contract.
- Check visible behavior, not just code presence.
- Confirm all acceptance criteria are satisfied.
- Confirm UX states:
  - Loading.
  - Empty.
  - Error.
  - Success.
  - Permission denied.
  - Offline or retry state where applicable.
- Confirm copy and UI behavior match spec.
- Confirm no user-facing regressions.
- Confirm issue can be closed by the PR.

### Acceptance Result

```text
REQ-001: PASS
Evidence: Unit test X, browser flow Y, code path Z.

REQ-002: FAIL
Reason: Form validation handles blank input but not whitespace-only input.
Required repair: Normalize input before validation and add test.
```

---

## 11. Tests and Edge-Case Coverage Strategy

### Required Verification Categories

Configurable but all supported:

- Lint.
- Typecheck.
- Unit tests.
- Integration tests.
- Browser tests.
- Build.
- Snapshot or visual checks when applicable.
- Migration tests where applicable.
- API contract tests where applicable.
- Accessibility checks where applicable.
- Performance smoke checks where applicable.

### Edge Cases

Verifier should look for:

- Empty input.
- Null or missing data.
- Malformed data.
- Large data sets.
- Slow network.
- Failed network.
- Permission denied.
- Auth expired.
- Duplicate submissions.
- Race conditions.
- Concurrent edits.
- Timezone and locale behavior.
- Mobile/responsive behavior.
- Browser console errors.
- Backwards compatibility for persisted data and public interfaces.

### Test Selection

The workflow should support:

```yaml
verification:
  commands:
    lint: "pnpm lint"
    typecheck: "pnpm typecheck"
    unit: "pnpm test"
    integration: "pnpm test:integration"
    build: "pnpm build"
    browser: "pnpm test:e2e"
  browser:
    enabled: true
    devServerCommand: "pnpm dev"
    url: "http://localhost:3000"
```

Commands are local and project-specific.

---

## 12. Security Review Strategy

### Security Scope

The security reviewer checks every candidate for:

- Authentication bypass.
- Authorization mistakes.
- Tenant or user data leakage.
- Unsafe shell execution.
- Unsafe file access.
- Injection vulnerabilities.
- XSS.
- CSRF where relevant.
- SSRF where relevant.
- Insecure deserialization.
- Secret exposure.
- Sensitive logs.
- Overbroad permissions.
- New dependencies with supply-chain risk.
- Unsafe browser storage.
- Missing rate limits where relevant.
- Migration or data-loss risk.

### Security Gates

Before PR creation:

- No blocking security findings.
- Major findings require fix or explicit human waiver.
- Dependency changes require review.
- Secret-looking values must not be committed.
- Auth, permission, and data-boundary changes require elevated scrutiny.

Config:

```yaml
security:
  requireReview: true
  blockOnHighSeverity: true
  requireHumanWaiverForHighSeverity: true
  dependencyAuditCommand: "pnpm audit"
```

---

## 13. PR Monitoring Loop

### Monitor Inputs

- PR URL/number.
- GitHub checks.
- Review comments.
- Issue comments.
- Requested changes.
- CI logs.
- Local workflow state.

### Loop Behavior

1. Poll PR state.
2. Fetch comments and review threads.
3. Fetch check runs.
4. Classify each item:
   - Clear code fix.
   - Test failure.
   - Formatting/lint issue.
   - Product ambiguity.
   - Architecture disagreement.
   - Security concern.
   - Needs human response.
5. Auto-fix clear issues if enabled.
6. Re-run relevant verification.
7. Push follow-up commits.
8. Reply to comments only when useful and configured.
9. Stop on merge, close, timeout, or user command.

### Config

```yaml
prMonitor:
  enabled: true
  intervalSeconds: 120
  maxDurationMinutes: 240
  autoFix:
    lint: true
    tests: true
    obviousReviewComments: true
    securityFindings: false
    behaviorChanges: false
  requireHumanApproval:
    productChanges: true
    architectureChanges: true
    securityWaivers: true
```

---

## 14. State, Logging, and Artifacts

### State Directory

```text
.agent-workflows/<task-id>/
  state.json
  config.snapshot.yaml
  intake.md
  intake.json
  requirements.md
  requirements.json
  decomposition.md
  verification-plan.md
  implementation-briefs/
  candidates/
  verification/
  pr/
  logs/
```

### State Machine

```text
initialized
intake-complete
requirements-drafted
requirements-approved
decomposition-complete
decomposition-approved
implementation-running
implementation-complete
verification-running
repair-running
candidate-selected
final-verification-running
pr-created
pr-monitoring
completed
failed
cancelled
```

### State File

```json
{
  "taskId": "gh-123-example",
  "source": {
    "type": "github-issue",
    "url": "https://github.com/org/repo/issues/123"
  },
  "status": "verification-running",
  "currentGate": null,
  "candidates": [
    {
      "id": "candidate-a",
      "branch": "agent/123-example/candidate-a",
      "worktree": "../.agent-worktrees/repo-123-candidate-a",
      "status": "repair-needed",
      "repairAttempts": 1
    }
  ],
  "pr": {
    "url": null,
    "branch": "agent/123-example/final"
  }
}
```

### Logs

Capture:

- Agent prompts.
- Agent summaries.
- Commands run.
- Command exit codes.
- Verification logs.
- Browser notes.
- Security findings.
- PR activity.
- Human approvals.

---

## 15. Failure and Retry Policy

### Failure Types

- Intake failure.
- Ambiguous requirements.
- Decomposition failure.
- Worktree creation failure.
- Implementation failure.
- Verification command failure.
- Browser verification failure.
- Security failure.
- PR creation failure.
- CI failure.
- Review comment failure.
- Merge conflict.

### Retry Defaults

```yaml
retry:
  intakeAttempts: 2
  implementationAttemptsPerCandidate: 2
  verificationAttempts: 2
  prCreateAttempts: 1
  monitorFixAttemptsPerIssue: 2
```

### Repair Loop

1. Verifier creates precise findings.
2. Finding is assigned to candidate implementer.
3. Implementer fixes only the finding and related tests.
4. Verifier reruns targeted checks.
5. Candidate returns to ranking or is rejected.

### Hard Stops

Stop and ask human when:

- Requirements are contradictory.
- Security issue requires product decision.
- Data migration risk is high.
- Reviewer requests unclear product change.
- CI failure cannot be reproduced locally.
- Merge conflict risks overwriting unrelated work.
- Human approval gate is enabled.

---

## 16. Config Files to Create

### Main Workflow Config

Path:

```text
.cursor-agent-workflow.yaml
```

Example:

```yaml
workflow:
  localOnly: true
  sourcePriority:
    - github-issue
    - direct-prompt
  successArtifact: github-pr

gates:
  requireApprovalAfterRequirements: false
  requireApprovalAfterDecomposition: true
  requireApprovalBeforePr: false
  allowNoGateMode: true

implementation:
  strategy: best-of-n
  candidateCount: 3
  maxRepairAttemptsPerCandidate: 2
  diversity:
    - minimal
    - test-first
    - robust-edge-cases

worktrees:
  root: "../.agent-worktrees"
  branchPrefix: "agent"
  cleanupRejected: false
  cleanupAfterPrMerge: true

verification:
  requireAllMustRequirementsCovered: true
  commands:
    lint: "pnpm lint"
    typecheck: "pnpm typecheck"
    unit: "pnpm test"
    integration: "pnpm test:integration"
    build: "pnpm build"
    browser: "pnpm test:e2e"
  browser:
    enabled: true
    devServerCommand: "pnpm dev"
    url: "http://localhost:3000"

security:
  requireReview: true
  blockOnHighSeverity: true
  dependencyAuditCommand: "pnpm audit"

github:
  defaultBaseBranch: "main"
  draftPr: false
  linkIssue: true
  useGhCli: true

prMonitor:
  enabled: true
  intervalSeconds: 120
  maxDurationMinutes: 240
  autoFixClearFailures: true
  requireApprovalForBehaviorChanges: true

artifacts:
  root: ".agent-workflows"
  keepCommandLogs: true
  keepBrowserScreenshots: true
  keepRejectedCandidates: true
```

### Cursor Rules

```text
.cursor/rules/workflow-local-only.md
.cursor/rules/requirements-traceability.md
.cursor/rules/implementation-agent.md
.cursor/rules/verifier-agent.md
.cursor/rules/security-review.md
.cursor/rules/pr-monitor.md
```

### Cursor Skills

```text
.cursor/skills/github-issue-intake/SKILL.md
.cursor/skills/po-spec-writer/SKILL.md
.cursor/skills/task-decomposer/SKILL.md
.cursor/skills/local-worktree-implementer/SKILL.md
.cursor/skills/candidate-verifier/SKILL.md
.cursor/skills/po-acceptance-checker/SKILL.md
.cursor/skills/security-reviewer/SKILL.md
.cursor/skills/browser-verifier/SKILL.md
.cursor/skills/pr-finalizer/SKILL.md
.cursor/skills/pr-monitor-manager/SKILL.md
```

### Hooks

```text
.cursor/hooks/hooks.json
.cursor/hooks/scripts/validate-workflow-start.sh
.cursor/hooks/scripts/create-worktree.sh
.cursor/hooks/scripts/capture-candidate-summary.sh
.cursor/hooks/scripts/validate-requirements.js
.cursor/hooks/scripts/validate-traceability.js
.cursor/hooks/scripts/check-no-secrets.sh
.cursor/hooks/scripts/start-pr-monitor.sh
```

### Prompt Templates

```text
.agent-prompts/intake.md
.agent-prompts/po-spec.md
.agent-prompts/decomposition.md
.agent-prompts/implementer.md
.agent-prompts/verifier.md
.agent-prompts/security-review.md
.agent-prompts/finalizer.md
.agent-prompts/pr-monitor.md
```

---

## 17. CLI and Cursor Commands

### Start from GitHub Issue

```bash
/agent-workflow start --issue https://github.com/org/repo/issues/123
```

Equivalent local command wrapper:

```bash
cursor-agent-workflow start --issue https://github.com/org/repo/issues/123
```

### Start from Direct Task

```bash
/agent-workflow start --task "Implement the requested behavior..."
```

### Run Without Mandatory Gates

```bash
/agent-workflow start --issue 123 --no-gates
```

### Decompose Only

```bash
/agent-workflow decompose --issue 123
```

### Launch Parallel Implementations

```bash
/agent-workflow implement --task-id gh-123-example --candidates 3
```

### Use Best-of-N

```bash
/best-of-n "Implement task gh-123-example using the approved requirements and candidate briefs"
```

The workflow should wrap `/best-of-n` with explicit worktree and artifact instructions.

### Verify Candidates

```bash
/agent-workflow verify --task-id gh-123-example
```

### Finalize PR

```bash
/agent-workflow finalize --task-id gh-123-example
```

### Monitor PR

```bash
/agent-workflow monitor-pr --pr 456
```

### Resume Workflow

```bash
/agent-workflow resume --task-id gh-123-example
```

### Cancel Workflow

```bash
/agent-workflow cancel --task-id gh-123-example
```

---

## 18. UX Flow

### Default Human-Gated Flow

1. User says:
   - “Implement GitHub issue #123.”
2. Intake agent fetches issue.
3. PO agent writes requirements.
4. If needed, PO asks clarifying questions.
5. Decomposition agent writes implementation plan and candidate briefs.
6. Cursor asks:
   - “Approve decomposition and launch implementation agents?”
7. User approves.
8. Multiple worktree agents implement in parallel.
9. Verifier checks each candidate.
10. Failed candidates enter repair loop.
11. Verifier selects best candidate.
12. Finalization agent creates PR.
13. PR manager monitors comments and CI.

### Aggressive Autonomy Flow

1. User says:
   - “Implement issue #123 with no mandatory gates.”
2. Intake, PO spec, decomposition, implementation, verification, finalization run automatically.
3. Human is interrupted only for hard blockers.
4. PR is opened.
5. PR manager monitors and fixes clear feedback.

### User Controls

The user can choose:

- Candidate count.
- Model or prompt variant per candidate.
- Verification strictness.
- Whether to require decomposition approval.
- Whether to allow auto-fix after PR comments.
- Whether browser testing is mandatory.
- Whether security findings can be waived.
- Whether PR is draft or ready for review.

---

## 19. Rollout Plan

### Phase 1: Foundation

- Define `.cursor-agent-workflow.yaml`.
- Create state directory format.
- Create task ID convention.
- Create GitHub issue intake skill.
- Create PO spec skill.
- Create decomposition skill.
- Add local-only rule.
- Add traceability rule.

Acceptance:

- User can provide a GitHub issue.
- Workflow produces intake, requirements, and decomposition artifacts.
- Default approval gate works.

---

### Phase 2: Worktree Implementation

- Add worktree creation hook.
- Add candidate branch naming.
- Add implementation skill.
- Add candidate artifact capture.
- Add `/best-of-n` wrapper instructions.
- Add resume support.

Acceptance:

- Workflow can launch multiple local implementation candidates in separate worktrees.
- Candidate summaries and changed files are captured.

---

### Phase 3: Verification

- Add verifier skill.
- Add configurable command runner.
- Add lint/typecheck/unit/build support.
- Add browser verification skill.
- Add PO acceptance checker.
- Add requirement coverage matrix.

Acceptance:

- Candidates can be accepted, rejected, or repaired.
- Every `must` requirement is checked.
- Verification logs are saved.

---

### Phase 4: Security and Quality Review

- Add security reviewer skill.
- Add dependency audit command support.
- Add secrets check hook.
- Add code review rubric.
- Add candidate ranking.

Acceptance:

- Security review is mandatory by config.
- Blocking security findings prevent PR creation.
- Candidate ranking includes security and maintainability.

---

### Phase 5: Finalization and PR Creation

- Add finalizer skill.
- Add PR body generation.
- Add final branch creation.
- Add final verification gate.
- Add `gh pr create`.

Acceptance:

- Successful workflow opens a GitHub PR.
- PR body includes issue link, requirements coverage, and verification evidence.

---

### Phase 6: PR Monitoring

- Add PR monitor skill.
- Add CI polling.
- Add review comment polling.
- Add auto-fix policy.
- Add follow-up commit flow.

Acceptance:

- PR manager detects comments and CI failures.
- Clear failures can be fixed locally.
- Ambiguous changes are escalated.

---

### Phase 7: Hardening and Customization

- Add more task sources behind the same intake interface.
- Add richer browser screenshots.
- Add workflow dashboard artifacts.
- Add cleanup commands.
- Add metrics for candidate success and verifier findings.
- Add project templates.

Acceptance:

- Workflow is reusable across repos.
- Config supports different stacks.
- Operators can tune autonomy and quality gates.

---

## 20. Risks and Mitigations

### Risk: Agents overwrite user changes

Mitigation:

- Require dirty-tree detection.
- Use isolated worktrees.
- Never reset or checkout over uncommitted work without approval.
- Preserve rejected candidates until safe cleanup.

### Risk: Parallel candidates diverge too much

Mitigation:

- Use precise requirement IDs and candidate briefs.
- Limit scope with rules.
- Require traceability for every material change.

### Risk: Verification misses user-visible behavior

Mitigation:

- Require PO acceptance checker.
- Use browser verification for UI changes.
- Include edge-case checklist.

### Risk: Agents create low-quality but passing code

Mitigation:

- Separate code review.
- Candidate ranking.
- Security review.
- Maintainability rubric.
- Best-of-N comparison.

### Risk: PR monitor applies unwanted behavior changes

Mitigation:

- Auto-fix only clear failures by default.
- Require approval for product, architecture, or security-sensitive changes.

### Risk: Local environment is inconsistent

Mitigation:

- Preflight checks.
- Capture tool versions.
- Save command logs.
- Allow project-specific setup commands.

### Risk: Long-running local workflow is hard to debug

Mitigation:

- Explicit state machine.
- Durable artifacts.
- Resume command.
- Per-agent logs.
- Candidate status files.

---

## 21. Pros and Cons

### Pros

- Fully local and Cursor-native.
- Highly customizable.
- Strong quality controls.
- Parallel candidate implementations improve solution quality.
- Worktrees isolate risk.
- Requirement traceability improves confidence.
- PR monitor keeps work moving after PR creation.
- No dependency on cloud agent execution.

### Cons

- Requires local machine resources.
- More moving parts than a single-agent workflow.
- Worktree and artifact cleanup need discipline.
- Browser and integration tests can be environment-sensitive.
- Best-of-N increases runtime and token/tool usage.
- Requires careful configuration per repository.

---

## 22. Exact Implementation Phases

1. Create workflow config schema.
2. Create artifact/state directory schema.
3. Create local-only Cursor rule.
4. Create requirement traceability Cursor rule.
5. Create GitHub issue intake skill.
6. Create PO spec writer skill.
7. Create task decomposition skill.
8. Create approval gate after decomposition.
9. Create worktree management hook/scripts.
10. Create implementation agent skill.
11. Create `/best-of-n` local worktree wrapper.
12. Create candidate artifact capture.
13. Create verifier skill.
14. Create command verification runner.
15. Create PO acceptance checker skill.
16. Create browser verifier skill.
17. Create security reviewer skill.
18. Create requirement coverage matrix generator.
19. Create candidate ranking and selection logic.
20. Create repair loop policy and prompts.
21. Create finalization skill.
22. Create PR body template.
23. Create final verification gate.
24. Create GitHub PR creation command.
25. Create PR monitor manager skill.
26. Create CI and review comment polling.
27. Create auto-fix classification policy.
28. Create resume/cancel/cleanup commands.
29. Add project template docs.
30. Trial on a small GitHub issue.
31. Trial on a medium UI issue with browser verification.
32. Trial on a security-sensitive or backend issue.
33. Tune defaults for autonomy, candidate count, and gates.
34. Roll out as the standard local Cursor workflow.
