## Local-Only Cursor SDK Orchestrator Spec

### Core Position
Build a custom local orchestrator as a TypeScript CLI/service using `@cursor/sdk` with **local runtime only**.

Every Cursor agent must be created with:

```ts
Agent.create({
  apiKey,
  model,
  local: {
    cwd: worktreePath,
    settingSources: []
  }
})
```

No `cloud` option is ever used. No Cursor Cloud Agents, no hosted execution, no `autoCreatePR`. All work happens on the developer’s machine or a local runner against checked-out repositories and local git worktrees.

The successful terminal output of a task is a GitHub PR created by local git and `gh`.

---

## Goals

Build an agentic workflow that:

- Starts primarily from GitHub issues, with a source abstraction for future task inputs.
- Uses Cursor as the main harness via the Cursor TypeScript SDK local runtime.
- Runs multiple local implementation agents in parallel, each in an isolated git worktree.
- Uses Product Owner, decomposition, implementation, verification, review, security, finalization, and PR monitoring agents.
- Supports human approval after requirements/decomposition by default.
- Supports aggressive autonomous mode with configurable gates.
- Verifies quality through lint, typecheck, unit tests, integration tests, browser tests, code review, security review, and PO acceptance coverage.
- Loops failed candidates back to implementers with structured feedback.
- Creates a GitHub PR locally.
- Continues monitoring PR comments and CI after opening the PR.

Non-goals:

- No Cursor Cloud Agents.
- No hosted execution by Cursor.
- No requirement to support non-GitHub task sources in v1, though the architecture must allow them.

---

## Architecture

### High-Level Components

1. **CLI Entrypoint**
   - `orchestrator issue <owner/repo#number>`
   - `orchestrator task <task-file>`
   - `orchestrator resume <run-id>`
   - `orchestrator monitor-pr <pr-url>`
   - `orchestrator status <run-id>`

2. **Task Intake Layer**
   - Reads GitHub issues first.
   - Normalizes future sources into a common `TaskInput`.
   - Sources can later include Linear, Notion, local markdown specs, Jira, Slack threads, or manual prompts.

3. **State Store**
   - Local filesystem state under `.orchestrator/runs/<runId>/`.
   - Optional SQLite for indexing runs, attempts, agents, artifacts, and PR monitor state.
   - Every prompt, response, command, test result, commit, diff, and decision is persisted.

4. **Agent Runtime Adapter**
   - Thin wrapper around `@cursor/sdk`.
   - Enforces local runtime only.
   - Handles `Agent.create`, `agent.send`, streaming, `run.wait`, `CursorAgentError`, disposal, cancellation, retries, and transcript capture.

5. **Workflow Engine**
   - State machine controller.
   - Decides when to spawn agents, verify candidates, loop failures, request human approval, or finalize.

6. **Worktree Manager**
   - Creates isolated worktrees for each candidate.
   - Names branches predictably.
   - Cleans up or preserves worktrees based on config.
   - Handles base branch updates and conflict recovery.

7. **GitHub Adapter**
   - Uses `gh` CLI and git locally.
   - Fetches issues, comments, labels, linked PRs, CI status, review comments.
   - Creates branches and PRs.
   - Posts optional status comments.

8. **Verification Harness**
   - Runs configured local commands.
   - Coordinates verifier agents.
   - Produces requirement coverage matrix and pass/fail decision.

9. **PR Monitor**
   - Background loop after PR creation.
   - Watches CI, review comments, requested changes, merge conflicts, new issue comments, and flaky failures.
   - Can spawn local fix agents in fresh worktrees and push updates to the PR branch.

---

## Cursor SDK Usage Model

### One Agent Per Role/Attempt

Use `Agent.create` for durable multi-turn agents that need context:

```ts
const agent = Agent.create({
  apiKey,
  model: { id: config.models.implementer },
  local: {
    cwd: worktreePath,
    settingSources: []
  }
});

try {
  const run = await agent.send(prompt);
  logRunIds(agent.agentId, run.id);

  if (run.supports("stream")) {
    for await (const event of run.stream()) {
      persistStreamEvent(event);
    }
  }

  const result = await run.wait();

  if (result.status !== "finished") {
    markRunFailed(result);
  }
} finally {
  await agent[Symbol.asyncDispose]();
}
```

Use `Agent.prompt` only for small one-shot analysis where no follow-up is needed, such as summarizing CI logs.

Use `Agent.resume` only when resuming a known local agent conversation in the same local cwd context. Inline MCP servers must be passed again on resume if used.

### Runtime Guardrail

The SDK wrapper must reject any options containing `cloud`.

```ts
function createLocalAgent(options: LocalAgentOptions) {
  if ("cloud" in options) {
    throw new Error("Cloud runtime is forbidden by orchestrator policy.");
  }

  return Agent.create({
    apiKey: options.apiKey,
    model: options.model,
    local: {
      cwd: options.cwd,
      settingSources: options.settingSources ?? []
    },
    mcpServers: options.mcpServers
  });
}
```

---

## Process Lifecycle

### Default Human-Gated Flow

1. User provides GitHub issue or task.
2. Intake fetches and normalizes task.
3. PO agent clarifies requirements.
4. If ambiguity remains, ask user targeted questions.
5. PO agent writes approved-ready spec.
6. Decomposition agent creates implementation tasks.
7. Human reviews and approves spec/decomposition.
8. Orchestrator creates parallel worktrees.
9. Implementation agents work independently.
10. Verifier runs checks and reviews each candidate.
11. Failed candidates receive structured feedback and retry.
12. Best passing candidate is selected.
13. Finalization agent polishes, squashes or organizes commits, updates docs/tests, prepares PR.
14. Local git pushes branch.
15. GitHub PR is created.
16. PR monitor watches CI and comments.
17. Fix agents address PR feedback until done or blocked.

### Aggressive Autonomous Flow

Same flow, but configurable gates are disabled:

- PO can proceed without user approval if confidence threshold is met.
- Decomposition can proceed automatically.
- Implementers can retry within budget.
- Finalizer can open PR automatically.
- PR monitor can push fixes automatically for low/medium-risk changes.

---

## Worktree Strategy

### Base Repository

The orchestrator runs from a canonical local repo checkout.

Before each run:

1. Confirm clean or configured dirty-tree policy.
2. Fetch origin.
3. Resolve base branch:
   - Issue target branch if known.
   - Repo default branch otherwise.
   - Config override if provided.
4. Create a run branch namespace.

### Worktree Layout

```text
.orchestrator/
  runs/
    <runId>/
      state.json
      requirements.md
      decomposition.json
      candidates/
        impl-01/
        impl-02/
        impl-03/
      verification/
      artifacts/
      logs/
../worktrees/
  <repo>-<runId>-impl-01/
  <repo>-<runId>-impl-02/
  <repo>-<runId>-impl-03/
  <repo>-<runId>-final/
  <repo>-<runId>-fix-01/
```

### Branch Naming

```text
orchestrator/<issue-number>/<runId>/impl-01
orchestrator/<issue-number>/<runId>/impl-02
orchestrator/<issue-number>/<runId>/final
orchestrator/<issue-number>/<runId>/fix-01
```

### Candidate Isolation

Each implementer gets:

- Same base commit.
- Same approved requirements.
- Same decomposition.
- Same repository state.
- Unique worktree and branch.
- No shared mutable files except orchestrator artifacts.

### Final Branch

The finalizer either:

- Promotes the best candidate branch, or
- Creates a fresh final worktree and selectively applies/cherry-picks the winning changes.

Prefer a fresh final branch when combining ideas from multiple candidates.

---

## GitHub Issue Intake

### Inputs

```bash
orchestrator issue owner/repo#123
orchestrator issue https://github.com/owner/repo/issues/123
orchestrator issue 123 --repo owner/repo
```

### Intake Captures

- Issue title.
- Body.
- Labels.
- Assignees.
- Milestone.
- Comments.
- Linked PRs.
- Referenced commits.
- Current repo default branch.
- Project metadata where available.
- Any screenshots or attachments as links.
- Existing discussion decisions.

### Normalized Task Model

```ts
type TaskInput = {
  id: string;
  source: "github_issue" | "manual" | "file" | string;
  title: string;
  description: string;
  sourceUrl?: string;
  repo: {
    owner: string;
    name: string;
    defaultBranch: string;
    localPath: string;
  };
  metadata: Record<string, unknown>;
  comments: TaskComment[];
  attachments: TaskAttachment[];
};
```

---

## Agent Roles

### 1. Product Owner Agent

Responsibilities:

- Understand the user task.
- Extract explicit requirements.
- Identify ambiguities.
- Ask clarifying questions when needed.
- Convert issue text into a concrete implementation spec.
- Define acceptance criteria.
- Define non-functional requirements.
- Define edge cases.
- Define expected tests.
- Produce a requirement traceability matrix seed.

Prompt shape:

```text
You are the Product Owner agent.

Input:
- GitHub issue/task
- Repository context summary
- Existing comments and decisions

Output:
- Problem statement
- User-visible behavior
- Functional requirements with stable IDs
- Non-functional requirements with stable IDs
- Acceptance criteria with stable IDs
- Edge cases
- Open questions
- Assumptions
- Test expectations
- Requirement traceability seed

Rules:
- Do not implement.
- Do not omit requested behavior.
- If requirements conflict, call it out.
- Prefer concrete, testable requirements.
```

### 2. Task-Writing / Decomposition Agent

Responsibilities:

- Break approved requirements into implementation tasks.
- Identify files, modules, tests, docs, migrations, config, and risk areas.
- Define task dependencies.
- Define parallelizable work.
- Define verification plan.
- Produce implementer briefs.

Prompt shape:

```text
You are the task decomposition agent.

Input:
- Approved PO spec
- Repository architecture summary
- Constraints
- Verification policy

Output:
- Implementation task graph
- Parallelization plan
- Candidate strategy
- Per-implementer brief
- Required tests
- Risk checklist
- Definition of done

Rules:
- Preserve every approved requirement.
- Do not defer requested features.
- Make tasks independently executable where possible.
```

### 3. Implementation Agents

Responsibilities:

- Implement assigned tasks locally in isolated worktrees.
- Add or update tests.
- Run local checks when instructed.
- Commit changes locally.
- Produce implementation notes.

Prompt shape:

```text
You are an implementation agent working in a local git worktree.

Input:
- Approved requirements
- Decomposition task brief
- Repo constraints
- Verification commands

Your job:
- Implement the assigned scope completely.
- Add appropriate tests.
- Keep changes focused.
- Preserve existing style.
- Commit your work locally.

Rules:
- Do not create a PR.
- Do not modify orchestrator artifacts.
- Do not skip requested requirements.
- If blocked, write a blocker report with evidence.
```

### 4. Verifier Agent

Responsibilities:

- Inspect candidate diffs.
- Run configured checks.
- Compare implementation to requirements.
- Identify missing tests, bugs, edge cases, quality issues.
- Decide pass/fail/needs-retry.
- Produce structured feedback for implementers.

Prompt shape:

```text
You are the verifier agent.

Input:
- Approved requirements
- Candidate diff
- Test outputs
- Implementation notes
- Repository conventions

Output:
- Pass/fail decision
- Requirement coverage matrix
- Bugs found
- Missing tests
- Edge cases not handled
- Code quality concerns
- Retry instructions

Rules:
- Be strict.
- Every requirement must be covered or explicitly marked blocked.
- Do not accept untested critical behavior.
```

### 5. Code Review Agent

Responsibilities:

- Review maintainability, architecture, readability, duplication, API design, error handling.
- Produce findings ordered by severity.
- Avoid style-only noise unless it affects quality.

### 6. Security Review Agent

Responsibilities:

- Review auth, permissions, injection, secrets, dependency risk, unsafe file/network access, data exposure, SSRF, XSS, CSRF, command execution, path traversal, deserialization, and supply chain risk.
- Check that logs and artifacts do not leak secrets.
- Verify tests cover security-sensitive paths when relevant.

### 7. PO Acceptance Agent

Responsibilities:

- Re-read original issue and approved spec.
- Evaluate whether final candidate satisfies user intent.
- Validate acceptance criteria.
- Reject technically passing work that misses product behavior.

### 8. Finalization Agent

Responsibilities:

- Promote or assemble final branch.
- Resolve minor polish issues.
- Ensure tests pass.
- Update docs/changelog if required.
- Prepare PR title/body.
- Create local commits in clean form.
- Hand off to GitHub adapter for PR creation.

### 9. PR Monitor / Background Manager

Responsibilities:

- Watch PR comments, reviews, CI, merge conflicts, and issue updates.
- Triage feedback.
- Spawn local fix agents.
- Push updates.
- Report blockers requiring human judgment.
- Stop when PR is merged, closed, or manually paused.

---

## State Machine

```text
NEW
  -> INTAKING_TASK
  -> SUMMARIZING_REPO
  -> PO_DRAFTING
  -> CLARIFICATION_NEEDED
  -> PO_SPEC_READY
  -> AWAITING_SPEC_APPROVAL
  -> DECOMPOSING
  -> DECOMPOSITION_READY
  -> AWAITING_DECOMPOSITION_APPROVAL
  -> PREPARING_WORKTREES
  -> IMPLEMENTING_PARALLEL
  -> VERIFYING_CANDIDATES
  -> RETRYING_FAILED_CANDIDATES
  -> SELECTING_CANDIDATE
  -> FINALIZING
  -> CREATING_PR
  -> MONITORING_PR
  -> COMPLETED
```

Failure states:

```text
BLOCKED_NEEDS_USER
FAILED_RETRY_EXHAUSTED
FAILED_ENVIRONMENT
FAILED_CONFLICT
FAILED_TEST_INFRA
CANCELLED
```

Approval gates are configurable. In autonomous mode, `AWAITING_*` states become logged checkpoints rather than blocking states.

---

## Requirement Traceability Model

Every requirement receives a stable ID.

Examples:

```text
FR-001: User can authenticate with GitHub issue URL input.
FR-002: Orchestrator creates isolated worktrees for parallel implementers.
NFR-001: No Cursor Cloud Agents are used.
AC-001: A successful task ends with a GitHub PR.
SEC-001: Secrets are not written to logs or PR bodies.
TEST-001: Unit tests cover task source normalization.
```

Traceability record:

```ts
type RequirementTrace = {
  id: string;
  type: "functional" | "non_functional" | "acceptance" | "security" | "test" | "edge_case";
  text: string;
  source: {
    kind: "github_issue" | "comment" | "user_approval" | "po_spec";
    url?: string;
    excerpt?: string;
  };
  priority: "must" | "should" | "could";
  status: "unimplemented" | "implemented" | "verified" | "failed" | "blocked";
  evidence: Evidence[];
};
```

Evidence:

```ts
type Evidence = {
  kind: "diff" | "test" | "review" | "manual" | "agent_note";
  path?: string;
  command?: string;
  result?: "pass" | "fail" | "unknown";
  summary: string;
};
```

Verifier output must update this matrix. Final PR body should include a concise coverage summary.

---

## Verifier Design

### Verification Layers

1. **Mechanical Checks**
   - Format.
   - Lint.
   - Typecheck.
   - Unit tests.
   - Integration tests.
   - Browser tests.
   - Build.
   - Dependency audit where configured.

2. **Diff Review**
   - Verifier agent reads changed files and implementation notes.
   - Code review agent checks maintainability.
   - Security review agent checks risk.

3. **Requirements Coverage**
   - PO acceptance agent maps final diff and test evidence to each requirement.
   - Any `must` requirement without evidence fails the candidate.

4. **Edge Case Review**
   - Compare PO edge cases to tests and implementation.
   - Require explicit evidence or an approved reason for non-coverage.

5. **Candidate Ranking**
   - Passing candidates ranked by:
     - Requirements coverage.
     - Test strength.
     - Simplicity.
     - Maintainability.
     - Risk.
     - Size of diff.
     - Compatibility with repo conventions.

### Verification Result

```ts
type CandidateVerification = {
  candidateId: string;
  decision: "pass" | "fail" | "retry" | "blocked";
  score: number;
  requirementCoverage: RequirementTrace[];
  checkResults: CheckResult[];
  findings: Finding[];
  retryPrompt?: string;
};
```

---

## Test and Edge-Case Coverage Strategy

### Test Discovery

The orchestrator should infer test commands from:

- Config file.
- `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`.
- Existing CI workflows.
- README or contributor docs.
- Repo-specific scripts.

### Test Classes

- Unit tests for changed logic.
- Integration tests for cross-module behavior.
- Browser tests for UI flows.
- Regression tests for issue-specific bugs.
- Snapshot tests only when already conventional.
- Security tests for auth, validation, injection, or permissions-sensitive changes.
- Migration tests when data shape changes.

### Edge Case Handling

Each PO edge case must become one of:

- Covered by automated test.
- Covered by verifier inspection with evidence.
- Marked not applicable with rationale.
- Marked blocked and escalated.

No silent dropping of edge cases.

---

## Security Review Strategy

Security review runs on every candidate and final branch.

Checklist:

- Secret leakage in code, tests, logs, prompts, artifacts, and PR body.
- Unsafe shell command construction.
- Path traversal and arbitrary file writes.
- SSRF and untrusted URL fetches.
- SQL/NoSQL/command/template injection.
- XSS and unsafe HTML rendering.
- CSRF and auth boundary regressions.
- Permission and tenancy checks.
- Dependency additions and lockfile changes.
- Token handling for GitHub and Cursor API keys.
- Browser automation handling of credentials.
- Over-broad file permissions.
- Sensitive data in telemetry.

Severity model:

```text
critical: must block PR
high: must fix before PR
medium: fix or explicitly accept with rationale
low: can be tracked but should be addressed when cheap
```

---

## PR Creation

The finalization agent prepares:

- Branch.
- Commit history.
- PR title.
- PR body.
- Test summary.
- Requirement coverage summary.
- Risk notes.
- Linked issue.

GitHub adapter executes locally:

```bash
git push -u origin <branch>
gh pr create \
  --repo owner/repo \
  --title "<title>" \
  --body-file .orchestrator/runs/<runId>/artifacts/pr-body.md
```

PR body template:

```md
## Summary
...

## Requirements Covered
- FR-001: ...
- AC-001: ...

## Verification
- Lint: pass
- Typecheck: pass
- Unit tests: pass
- Integration tests: pass
- Browser tests: pass
- Security review: pass
- PO acceptance: pass

## Risks
...

Closes #123
```

---

## PR Monitoring Loop

### Triggers

- Polling interval.
- Manual `orchestrator monitor-pr`.
- GitHub webhook later, optional.
- CI status changes.
- New review comments.
- Requested changes.
- Merge conflict.
- New issue comments after PR open.

### Loop

1. Fetch PR status.
2. Fetch CI checks.
3. Fetch review comments.
4. Classify events:
   - CI failure.
   - Reviewer requested change.
   - Reviewer question.
   - Merge conflict.
   - Approval.
   - Comment requiring product decision.
5. Decide:
   - Auto-fix.
   - Ask human.
   - Ignore informational comment.
   - Stop.
6. For auto-fix:
   - Create fix worktree from PR branch.
   - Spawn fix agent.
   - Run targeted verification.
   - Push to PR branch.
   - Comment with summary if configured.

### Stop Conditions

- PR merged.
- PR closed.
- User pauses run.
- Retry budget exhausted.
- Human decision required.
- Security-critical issue found.
- Local environment unavailable.

---

## State, Logging, and Artifacts

### Run Directory

```text
.orchestrator/runs/<runId>/
  state.json
  config.resolved.json
  task-input.json
  repo-summary.md
  requirements.md
  requirements.trace.json
  decomposition.json
  approvals.json
  agents/
    po.json
    decomposer.json
    impl-01.json
    verifier.json
  prompts/
  transcripts/
  candidates/
  verification/
  commands/
  artifacts/
    pr-body.md
    final-summary.md
  monitor/
    events.jsonl
```

### Logging

Use structured JSONL logs:

```ts
type LogEvent = {
  timestamp: string;
  runId: string;
  level: "debug" | "info" | "warn" | "error";
  component: string;
  event: string;
  data?: unknown;
};
```

### Artifact Policy

Persist enough to resume and audit:

- Inputs.
- Approved requirements.
- Prompts.
- Agent IDs and run IDs.
- Tool/command outputs.
- Diffs.
- Test results.
- Verification decisions.
- PR URL.
- Monitor events.

Redact secrets before writing logs.

---

## Failure and Retry Policy

### Failure Types

- SDK startup failure.
- Agent run failure.
- Git worktree failure.
- Merge conflict.
- Test failure.
- Verification failure.
- Security failure.
- GitHub API failure.
- Human approval timeout.
- Local environment failure.

### Retry Rules

- Retry SDK startup only when `CursorAgentError.isRetryable` is true.
- Retry implementation candidates with verifier feedback up to `maxImplementationRetries`.
- Retry flaky tests using configured flake policy.
- Do not auto-retry security-critical findings without explicit fix plan.
- Do not continue if local repo state is unsafe unless configured.

### Budgets

```yaml
retries:
  sdkStartup: 2
  implementationPerCandidate: 2
  verificationCommand: 1
  prMonitorFixes: 5
  ciFailureFixes: 3
```

---

## Config Schema

Example `orchestrator.config.yaml`:

```yaml
runtime:
  cursor:
    apiKeyEnv: CURSOR_API_KEY
    localOnly: true
    settingSources: []
    models:
      po: composer-2
      decomposer: composer-2
      implementer: composer-2
      verifier: composer-2
      codeReviewer: composer-2
      securityReviewer: composer-2
      finalizer: composer-2

repo:
  defaultBaseBranch: main
  requireCleanTree: true
  worktreeRoot: ../worktrees
  preserveFailedWorktrees: true

github:
  cli: gh
  defaultRepo: owner/repo
  prDraft: false
  labels:
    onOpen:
      - agentic
  commentOnIssue: true

workflow:
  approval:
    requireSpecApproval: true
    requireDecompositionApproval: true
    requireBeforePr: false
  autonomy:
    mode: gated
    allowAutoFixPrComments: true
    allowAutoPushPrFixes: true
  parallelism:
    implementationCandidates: 3
    maxConcurrentAgents: 3

verification:
  commands:
    formatCheck: pnpm format:check
    lint: pnpm lint
    typecheck: pnpm typecheck
    unit: pnpm test:unit
    integration: pnpm test:integration
    browser: pnpm test:e2e
    build: pnpm build
  require:
    lint: true
    typecheck: true
    unit: true
    integration: true
    browser: true
    codeReview: true
    securityReview: true
    poAcceptance: true
  flakyTestRetries: 1

security:
  blockOnCritical: true
  blockOnHigh: true
  scanSecrets: true
  dependencyAuditCommand: pnpm audit

monitoring:
  enabled: true
  pollIntervalSeconds: 60
  stopOnApproval: false
  stopOnMerge: true
  maxFixLoops: 5

artifacts:
  root: .orchestrator/runs
  redactSecrets: true
  keepTranscripts: true
```

---

## CLI Commands

```bash
orchestrator init
orchestrator issue owner/repo#123
orchestrator issue https://github.com/owner/repo/issues/123
orchestrator task ./task.md
orchestrator approve <runId> spec
orchestrator approve <runId> decomposition
orchestrator run <runId>
orchestrator resume <runId>
orchestrator status <runId>
orchestrator candidates <runId>
orchestrator verify <runId> --candidate impl-01
orchestrator finalize <runId> --candidate impl-01
orchestrator create-pr <runId>
orchestrator monitor-pr <pr-url>
orchestrator pause <runId>
orchestrator cancel <runId>
orchestrator cleanup <runId>
```

Autonomous mode:

```bash
orchestrator issue owner/repo#123 --autonomous
orchestrator issue owner/repo#123 --no-spec-gate --no-decomposition-gate --auto-pr
```

---

## UX Flow

### Gated Default

```text
User runs:
  orchestrator issue owner/repo#123

System:
  Fetches issue
  Drafts PO spec
  Shows requirements and questions

User:
  Answers questions or approves

System:
  Decomposes work
  Shows task graph and candidate plan

User:
  Approves decomposition

System:
  Runs parallel local implementers
  Verifies candidates
  Selects winner
  Finalizes branch
  Opens PR
  Starts PR monitor
```

### Autonomous

```text
User runs:
  orchestrator issue owner/repo#123 --autonomous

System:
  Proceeds through PO, decomposition, implementation, verification, finalization, PR creation, and monitoring
  Stops only for blockers, exhausted retries, high-risk decisions, or configured gates
```

---

## Rollout Plan

### Phase 1: Local SDK Harness

- TypeScript CLI scaffold.
- Config loader.
- Local-only Cursor SDK wrapper.
- Structured logging.
- Run directory state.
- Basic `Agent.create` / `agent.send` / `run.wait` lifecycle.
- Explicit cloud runtime guard.

### Phase 2: GitHub Issue Intake

- Parse issue references.
- Fetch issue via `gh`.
- Normalize task model.
- Store issue snapshot.
- Generate initial task summary.

### Phase 3: PO and Decomposition

- PO agent prompt and output schema.
- Clarification flow.
- Approval gates.
- Decomposition agent prompt and output schema.
- Requirement traceability seed.

### Phase 4: Worktree and Parallel Implementers

- Worktree manager.
- Candidate branch naming.
- Parallel implementation agents.
- Candidate artifact capture.
- Retry loop scaffolding.

### Phase 5: Verification Harness

- Configurable command runner.
- Lint/typecheck/unit/integration/browser/build support.
- Verifier agent.
- Requirement coverage matrix.
- Candidate scoring.

### Phase 6: Review Agents

- Separate code review agent.
- Separate security review agent.
- PO acceptance agent.
- Strict pass/fail policy.

### Phase 7: Finalization and PR Creation

- Candidate promotion.
- Final branch creation.
- Final checks.
- PR body generation.
- `gh pr create`.
- Issue linking and optional comments.

### Phase 8: PR Monitoring

- Poll PR comments/reviews/checks.
- Classify events.
- Spawn fix agents.
- Push PR updates.
- Stop conditions and status reporting.

### Phase 9: Hardening

- Resume support.
- Cancellation.
- Secret redaction.
- Better conflict handling.
- Rich status command.
- Cleanup policies.
- Metrics and audit reports.

---

## Risks and Mitigations

- **Local environment drift:** Require preflight checks and persist resolved tool versions.
- **Runaway autonomy:** Use budgets, gates, stop conditions, and severity policies.
- **Bad requirement interpretation:** PO clarification plus human approval by default.
- **Parallel agents duplicating mistakes:** Use diverse implementer prompts and independent verifier review.
- **Secret leakage:** Redaction layer, security review, and log scanning.
- **Flaky tests:** Explicit flake retry policy and separate flaky classification.
- **Merge conflicts:** Isolated worktrees and final branch assembly.
- **SDK resource leaks:** Always dispose agents in `finally`.
- **Cloud runtime accidental use:** Central SDK wrapper rejects `cloud`.
- **PR monitor over-applies fixes:** Restrict by severity/risk and require human approval for product decisions.

---

## Pros and Cons

### Pros

- Fully local execution.
- Maximum customizability.
- Strong quality gates.
- Parallel exploration improves solution quality.
- Auditable artifacts and traceability.
- Works with normal local git/GitHub workflows.
- Future task sources fit behind the intake abstraction.

### Cons

- More engineering effort than using hosted agents.
- Requires a healthy local dev environment.
- Parallel worktrees consume disk and CPU.
- Long-running PR monitoring needs local process supervision.
- More orchestration code to maintain.
- GitHub permissions and local credentials must be configured carefully.

---

## Success Criteria

A task is successful when:

- Every approved must-have requirement is implemented or explicitly accepted as blocked by the user.
- Lint, typecheck, required tests, build, code review, security review, and PO acceptance pass.
- Requirement traceability has evidence for each acceptance criterion.
- A GitHub PR is opened from a local branch.
- PR body summarizes requirements, verification, and risks.
- PR monitor is active or intentionally disabled by config.
