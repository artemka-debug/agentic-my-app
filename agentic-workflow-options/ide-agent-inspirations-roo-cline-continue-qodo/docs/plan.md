## Cursor-Local Agentic Workflow Spec
Build a **local-first, Cursor-centered agent harness** that takes GitHub issues to pull requests through a configurable multi-agent workflow:

`GitHub issue / user task -> PO spec -> task decomposition -> parallel local worktree implementers -> verifier loop -> finalizer PR -> PR manager`

Cursor remains the primary human interface, approval surface, code review surface, terminal runner, and orchestration host. No cloud agents, no remote execution, and no managed background coding environments are used. All work happens on the developer’s machine in local git worktrees.

---

## 1. Tool Comparison And Recommendation
### Roo Code
Roo Code is the strongest inspiration for this design because it already models several ideas the user wants: role-based modes, custom agents, faster autonomy, task modes, diff review, local shell/file access, and a more customizable workflow than many IDE assistants.

Recommendation: **use as inspiration, not as the main harness**.

Reasons:
- Cursor must remain the harness.
- Roo’s mode system maps well to `ProductOwner`, `TaskWriter`, `Implementer`, `Verifier`, `SecurityReviewer`, and `Finalizer`.
- Its customization model is worth copying: role-specific prompts, tools, permissions, and approval gates.
- Direct use would split the user experience across IDE agent systems.

### Cline
Cline is a strong reference for safe agent execution, explicit tool use, terminal/file approval patterns, and auditable step-by-step local changes.

Recommendation: **use as inspiration, not directly**.

Reasons:
- It is useful for approval mechanics, tool transparency, and human-in-the-loop design.
- Its conservative execution model is helpful for failed-verification loops.
- Direct use would make Cursor secondary, which conflicts with the requirement.

### Continue
Continue is best viewed as a source of ideas for local context indexing, local model flexibility, and developer-controlled configuration.

Recommendation: **use selected ideas/components only if they can run locally and integrate into Cursor**.

Reasons:
- Continue’s context/RAG patterns are useful for requirement-aware coding.
- Its local model support is relevant.
- It is less aligned with full autonomous multi-agent implementation than Roo/Cline.
- Do not use Continue as the primary workflow shell.

### Qodo
Qodo is most relevant for quality, review, test generation, PR/CI review, and judge-style aggregation of multiple reviewers.

Recommendation: **use as inspiration for verifier/reviewer design; direct use only if deployed locally or self-hosted and allowed by policy**.

Reasons:
- Its multi-reviewer quality model maps well to separate correctness, security, testing, architecture, and requirements reviewers.
- Cloud PR/CI agents are disallowed.
- If using Qodo directly requires SaaS/cloud execution, it must not be part of the core workflow.
- On-prem or local CLI modes could be optional integrations, but Cursor-local verification must work without Qodo.

### Final Tool Position
Use **Cursor as the harness**, with a custom local orchestrator implementing the workflow. Borrow:
- Roo Code: customizable modes and aggressive autonomy.
- Cline: local tool safety and approval checkpoints.
- Continue: local context/indexing ideas.
- Qodo: multi-agent review, judge aggregation, test/security emphasis.

Do not make any of them the main agent shell.

---

## 2. Product Goals
The system should let a user start from a GitHub issue or manually entered task and receive a high-quality GitHub PR after local autonomous implementation.

Primary goals:
- Cursor is the main interface.
- Execution is local.
- Git work happens in isolated local worktrees.
- Multiple implementation agents can work in parallel.
- Verification is stricter than a normal coding assistant pass.
- Requirements are traceable from issue to spec to implementation to tests to PR.
- Human approval exists after decomposition by default.
- Approval gates are configurable and can be disabled for aggressive autonomy.
- The final output is a GitHub pull request.
- After PR creation, a local background manager monitors comments and CI, then fixes issues locally.

---

## 3. Non-Negotiable Requirements
All are in scope:

- GitHub issue intake.
- Manual task intake.
- Future source adapters.
- Product Owner clarification.
- Requirements/spec generation.
- Task decomposition.
- Human approval after decomposition by default.
- Configurable no-gate autonomous mode.
- Parallel local implementers.
- Local git worktree isolation.
- Candidate verification.
- Failed candidate retry loop.
- Lint verification.
- Typecheck verification.
- Unit tests.
- Integration tests.
- Browser tests.
- Separate code review.
- Security review.
- PO requirements coverage review.
- Edge-case review.
- Final PR creation.
- Background PR comment and CI monitoring.
- Local-only execution.
- Cursor-centered UX.
- Customizable roles, prompts, commands, policies, and gates.
- Durable state, logs, and artifacts.

---

## 4. Architecture
### Main Components
`Cursor IDE`
- Primary user interface.
- Shows specs, plans, diffs, logs, test results, and PR status.
- Runs local commands through terminal/tasks.
- Hosts or invokes the orchestrator.
- Provides approval checkpoints.

`Local Orchestrator`
- A local CLI/service invoked from Cursor.
- Owns workflow state machine.
- Spawns role agents.
- Creates worktrees.
- Runs verification.
- Selects winning candidate.
- Creates PR.
- Starts PR monitoring loop.

`Agent Runtime`
- Runs role-specific prompts against configured local model/runtime.
- Must support local models through providers like Ollama, LM Studio, llama.cpp, local OpenAI-compatible endpoints, or other local inference endpoints.
- Optional remote model support should exist only behind an explicit `localOnly: false` override, but the required deployment profile is `localOnly: true`.

`Git Workspace Manager`
- Creates worktrees per candidate.
- Tracks branches.
- Prevents cross-candidate contamination.
- Supports cleanup, archiving, and reproduction.

`GitHub Adapter`
- Reads issues.
- Posts clarification questions if configured.
- Creates branches and PRs.
- Updates PR body.
- Monitors comments, reviews, and checks.
- Never uses GitHub-hosted coding agents.

`Verifier Pipeline`
- Runs deterministic checks.
- Runs agentic review passes.
- Produces requirement coverage matrix.
- Scores candidates.
- Sends failures back to implementers.

`Artifact Store`
- Local directory under the repo, for example `.agentic/`.
- Stores specs, decomposition, traces, logs, verifier reports, review findings, candidate summaries, PR metadata, and retry history.

---

## 5. Cursor As The Harness
Cursor remains the harness by making every workflow action visible and controllable from Cursor.

Implementation approach:
- Add a local CLI such as `agentic`.
- Add Cursor tasks or commands for:
  - `Agentic: Intake GitHub Issue`
  - `Agentic: Draft Spec`
  - `Agentic: Approve Decomposition`
  - `Agentic: Run Implementers`
  - `Agentic: Verify Candidates`
  - `Agentic: Finalize PR`
  - `Agentic: Monitor PR`
- Use Cursor terminals for command execution.
- Use Cursor editor panes for generated specs, plans, traces, and reports.
- Use Cursor diff/review UI for chosen candidate review.
- Use local MCP only when useful and local.

The system should not require opening Roo, Cline, Continue, or Qodo as separate IDE controllers.

---

## 6. Local Execution And Worktree Strategy
Each candidate implementation runs in a separate local git worktree:

```text
repo/
worktrees/
  issue-123-candidate-a/
  issue-123-candidate-b/
  issue-123-candidate-c/
.agentic/
  runs/
    issue-123-2026-05-08T...
```

Branch naming:
- `agentic/issue-123/spec`
- `agentic/issue-123/candidate-a`
- `agentic/issue-123/candidate-b`
- `agentic/issue-123/final`

Candidate lifecycle:
1. Start from clean base branch.
2. Create `N` worktrees.
3. Give each implementer the same approved spec and task decomposition.
4. Optionally vary strategy prompts per candidate.
5. Run implementation locally.
6. Run verifier pipeline.
7. Rank candidates.
8. Either select best, merge selected patches, or ask implementers to retry.
9. Finalizer prepares clean PR branch.

Isolation rules:
- No implementer writes directly to the main repo.
- No candidate can modify another candidate’s worktree.
- Shared cache is read-only unless explicitly configured.
- Secrets are not copied into artifact bundles.
- Worktree cleanup is explicit and configurable.

---

## 7. GitHub Issue Intake
### Inputs
- GitHub issue URL.
- GitHub issue number.
- Manual task text.
- Future adapters: Linear, Notion, Jira, Slack, local markdown, email, customer ticket.

### GitHub Intake Steps
1. Fetch issue title, body, labels, comments, assignees, milestone, linked PRs, and linked issues.
2. Detect issue type:
   - bug
   - feature
   - refactor
   - test
   - security
   - performance
   - documentation
   - maintenance
3. Extract initial requirements.
4. Extract constraints.
5. Extract acceptance hints.
6. Identify ambiguity.
7. Generate PO clarification questions.
8. Either ask user in Cursor or post questions to GitHub if configured.
9. Produce approved requirement spec.

### Intake Artifact
`requirements.md` should contain:
- Problem statement.
- User story or job-to-be-done.
- Explicit requirements.
- Non-functional requirements.
- Acceptance criteria.
- Out-of-scope only if the original task explicitly excludes something.
- Assumptions.
- Open questions.
- Test expectations.
- Risk areas.
- Requirement IDs.

---

## 8. Product Owner Agent
### Responsibility
The Product Owner agent converts vague input into a buildable, testable specification.

### Prompt Contract
The PO agent must:
- Preserve every requested feature.
- Ask clarifying questions where needed.
- Make assumptions explicit.
- Convert requirements into acceptance criteria.
- Assign stable requirement IDs.
- Define done in terms of user-visible behavior and verification.
- Avoid implementation decisions unless necessary.
- Flag contradictions.

### Output
`spec.md`:
- Summary.
- Background.
- Goals.
- Personas/users.
- Requirements.
- Acceptance criteria.
- Non-functional requirements.
- Edge cases.
- Dependencies.
- Risks.
- Requirement trace IDs.

Example requirement IDs:
- `REQ-001`: Accept GitHub issue URL as task source.
- `REQ-002`: Generate PO clarification questions.
- `REQ-003`: Run implementation agents in local worktrees.
- `REQ-004`: Verify lint, typecheck, tests, browser behavior, security, and acceptance coverage.
- `REQ-005`: Create GitHub PR after successful verification.

---

## 9. Task-Writing / Decomposition Agent
### Responsibility
Split approved requirements into implementation tasks that parallel agents can execute.

### Output
`decomposition.md`:
- Task graph.
- Task dependencies.
- Files or areas likely affected.
- Test plan per task.
- Verification expectations.
- Risk classification.
- Suggested candidate strategies.
- Estimated complexity.
- Required approvals.

### Human Approval Gate
Default behavior:
- Stop after decomposition.
- Show spec and task plan in Cursor.
- Ask the user to approve, modify, or reject.

Configurable behavior:
- `approval.afterDecomposition: required | optional | disabled`
- `approval.mode: conservative | balanced | autonomous`
- `autonomy.maxSpendMinutes`
- `autonomy.maxRetries`
- `autonomy.allowPRCreation`

---

## 10. Implementation Agents
### Role
Multiple local implementers work independently against the same approved decomposition.

### Candidate Strategies
The orchestrator should support strategy diversity:
- Minimal-change candidate.
- Test-first candidate.
- Refactor-friendly candidate.
- Performance-focused candidate.
- Security-focused candidate.
- UI/browser-focused candidate.

### Implementer Prompt Requirements
Each implementer receives:
- Original issue.
- Approved spec.
- Decomposition.
- Requirement IDs.
- Repo overview.
- Coding conventions.
- Verification commands.
- Security constraints.
- Candidate strategy.
- Retry feedback if applicable.

Implementers must:
- Work only in assigned worktree.
- Keep changes focused.
- Add or update tests.
- Update docs only when relevant.
- Produce an implementation summary.
- Map changed behavior to requirement IDs.
- Record risks and unknowns.

### Output
Each candidate produces:
- Diff.
- Implementation notes.
- Requirement coverage notes.
- Test notes.
- Known limitations.
- Retry notes if applicable.

---

## 11. Requirement Traceability Model
Every requirement should be tracked from intake through PR.

### Core Entities
`Requirement`
- `id`
- `title`
- `description`
- `source`
- `priority`
- `acceptanceCriteria`
- `verificationMethods`
- `status`

`ImplementationTask`
- `id`
- `requirementIds`
- `description`
- `dependencies`
- `expectedFiles`
- `testExpectations`

`VerificationResult`
- `requirementId`
- `status: pass | fail | partial | unverified`
- `evidence`
- `checks`
- `reviewer`
- `notes`

`Candidate`
- `id`
- `worktree`
- `branch`
- `diffSummary`
- `requirementsCovered`
- `checks`
- `score`
- `blockingFailures`

### Coverage Matrix
The verifier must produce:
- Requirement ID.
- Candidate status.
- Evidence.
- Test coverage.
- Manual review notes.
- PO acceptance result.
- Security result.
- Final PR coverage status.

No candidate can finalize while any required acceptance criterion is `fail` or `unverified`, unless explicitly overridden.

---

## 12. Verifier Design
The verifier is a deterministic plus agentic pipeline.

### Deterministic Checks
Run configured commands:
- Format check.
- Lint.
- Typecheck.
- Unit tests.
- Integration tests.
- Browser/e2e tests.
- Build.
- Package audit where relevant.
- Dependency/license check where relevant.
- Secret scan.
- Static security scan where relevant.

### Agentic Reviewers
Separate reviewer agents:
- `CodeReviewer`: correctness, maintainability, architecture fit.
- `SecurityReviewer`: injection, authz/authn, data exposure, unsafe dependencies, secret handling.
- `TestReviewer`: missing test coverage, weak assertions, brittle tests.
- `POReviewer`: acceptance criteria and requirement coverage.
- `EdgeCaseReviewer`: boundary cases, concurrency, empty/error states, migration issues.
- `UXReviewer`: user flow, copy, accessibility, browser behavior where applicable.
- `Judge`: aggregates findings, removes duplicates, ranks severity, decides pass/fail.

### Verifier Output
`verification-report.md`:
- Candidate summary.
- Command results.
- Requirement coverage matrix.
- Review findings.
- Security findings.
- Test gaps.
- Edge cases.
- Regression risks.
- Pass/fail decision.
- Retry instructions.

### Candidate Scoring
Score candidates across:
- Requirement coverage.
- Test pass rate.
- Code quality.
- Maintainability.
- Minimality.
- Security.
- Risk.
- Simplicity.
- UX correctness.
- Reviewer confidence.

Blocking issues always override score.

---

## 13. PO Acceptance Criteria Checking
PO acceptance review is separate from code review.

The PO reviewer checks:
- Does the implementation satisfy every accepted requirement?
- Are user-visible flows complete?
- Are default behaviors correct?
- Are configuration options documented?
- Are error states handled?
- Are edge cases from the spec covered?
- Does the PR body explain the change in product terms?
- Are any requirements silently skipped?

Output:
- `accepted`
- `accepted_with_notes`
- `rejected`
- `needs_clarification`

A PR cannot be created by default if PO review is `rejected`.

---

## 14. Tests And Edge-Case Strategy
### Test Selection
The decomposition agent proposes tests; the verifier enforces them.

Test categories:
- Unit tests for pure logic.
- Integration tests for cross-module behavior.
- Browser/e2e tests for user workflows.
- Regression tests for bugs.
- Contract tests for APIs.
- Migration tests for schema/data changes.
- Accessibility checks for UI.
- Performance smoke checks where relevant.
- Snapshot tests only when already used by the repo.

### Edge Cases
The edge-case reviewer must consider:
- Empty states.
- Invalid inputs.
- Permission errors.
- Network/API failures.
- Race conditions.
- Large data sets.
- Time zones and dates.
- Retries and idempotency.
- Partial failure.
- Backward compatibility.
- Feature flags.
- Browser/device variance.
- Security boundaries.

### Browser Testing
Browser tests should run locally with Playwright, Cypress, Webdriver, or existing repo tools. The harness should:
- Start local dev server.
- Detect ports.
- Capture screenshots/videos/traces on failure.
- Store artifacts locally.
- Include browser evidence in verification report.

---

## 15. Security Review Strategy
Security review is mandatory for all candidates.

Checks:
- Secret scanning.
- Dependency vulnerability scan.
- Static analysis where available.
- Authentication and authorization review.
- Input validation review.
- Injection risks.
- XSS/CSRF/SSRF risks.
- Path traversal.
- Unsafe shell execution.
- Unsafe deserialization.
- Data leakage.
- Logging of sensitive values.
- Permission broadening.
- Supply chain risk.
- License risk where relevant.

Security reviewer output:
- Severity.
- Exploit scenario.
- Affected requirement/task.
- Suggested fix.
- Blocking status.

Critical and high security findings block finalization by default.

---

## 16. Failure And Retry Policy
### Retry Loop
Failed candidates return to implementers with structured feedback.

Retry packet:
- Failed commands.
- Reviewer findings.
- Requirement gaps.
- Security issues.
- Test failures.
- Suggested target areas.
- Explicit non-goals.

Retry policies:
- Retry same candidate up to `maxRetriesPerCandidate`.
- Spawn replacement candidates if configured.
- Stop early if one candidate passes all gates.
- Escalate to user if repeated failures share the same root cause.
- Preserve failed candidate artifacts for audit.

### Failure Classes
- `spec_ambiguity`: needs PO/user clarification.
- `implementation_failure`: candidate did not build or test.
- `verification_failure`: checks failed.
- `security_failure`: blocking security finding.
- `requirements_failure`: acceptance criteria not met.
- `environment_failure`: local setup issue.
- `github_failure`: issue/PR API problem.
- `merge_failure`: branch conflict.

---

## 17. Finalization Agent
### Responsibility
Create a clean PR-ready branch from the winning implementation.

Steps:
1. Select winning candidate.
2. Rebase or merge onto latest base branch.
3. Resolve conflicts locally.
4. Run full verifier again on final branch.
5. Ensure requirement coverage is complete.
6. Generate PR title/body.
7. Create GitHub PR.
8. Link issue.
9. Attach verification summary.
10. Start PR monitoring loop.

### PR Body
Should include:
- Summary.
- Linked issue.
- Requirements covered.
- Implementation notes.
- Test plan.
- Verification commands/results.
- Screenshots or browser artifacts if relevant.
- Security review result.
- Known risks.
- Rollback notes.

---

## 18. Background PR Reviewer / Manager
After PR creation, a local background manager monitors GitHub.

Responsibilities:
- Poll or subscribe to PR comments.
- Watch requested changes.
- Watch CI/check status.
- Classify comments.
- Ignore non-actionable comments when safe.
- Convert actionable comments into tasks.
- Apply fixes locally in PR branch.
- Run relevant verification.
- Push updates.
- Reply to comments with resolution notes if configured.

Loop:
1. Fetch PR state.
2. Detect new comments/check failures.
3. Classify issues.
4. Create fix plan.
5. Implement locally.
6. Verify.
7. Push.
8. Respond/update artifacts.
9. Continue until PR is merged, closed, or stopped.

Policy:
- Do not auto-merge unless explicitly configured.
- Do not bypass required checks.
- Do not force-push unless explicitly configured.
- Escalate unclear review comments to user.

---

## 19. State, Logging, And Artifacts
All run state is local and durable.

Suggested structure:

```text
.agentic/
  config.yaml
  runs/
    run-id/
      intake.json
      issue.md
      spec.md
      decomposition.md
      approvals.json
      candidates/
        candidate-a/
          branch.txt
          implementation-summary.md
          verification-report.md
          command-results.json
          review-findings.json
          artifacts/
      final/
        pr-body.md
        verification-report.md
        traceability.json
      logs/
        orchestrator.log
        agents.jsonl
        commands.jsonl
        github.jsonl
```

Logs should include:
- Agent prompts.
- Agent outputs.
- Tool commands.
- Exit codes.
- Timestamps.
- Worktree paths.
- Git SHAs.
- Verification evidence.
- Approval decisions.
- Retry history.

Sensitive data rules:
- Redact tokens.
- Avoid storing `.env` values.
- Exclude secrets from artifacts.
- Configurable retention.

---

## 20. Configuration Schema
Example:

```yaml
version: 1

localOnly: true

github:
  owner: example
  repo: app
  defaultBaseBranch: main
  auth: gh-cli
  issueLabels:
    include: []
    exclude: []
  pr:
    draftByDefault: false
    autoCreate: true
    autoRespondToComments: false
    autoMerge: false

models:
  defaultProvider: ollama
  providers:
    ollama:
      baseUrl: http://localhost:11434
      model: qwen2.5-coder
    lmstudio:
      baseUrl: http://localhost:1234/v1
      model: local-model
  roles:
    productOwner:
      provider: ollama
      model: qwen2.5-coder
    implementer:
      provider: ollama
      model: qwen2.5-coder
    verifier:
      provider: ollama
      model: qwen2.5-coder

workflow:
  sourceAdapters:
    - github
    - manual
  approval:
    afterSpec: optional
    afterDecomposition: required
    beforePR: optional
  autonomy:
    mode: balanced
    allowNoGateRun: true
    maxCandidates: 4
    maxRetriesPerCandidate: 2
    maxTotalRuntimeMinutes: 180

worktrees:
  root: ../agentic-worktrees
  cleanup: ask
  keepFailedCandidates: true

commands:
  install: ""
  formatCheck: npm run format:check
  lint: npm run lint
  typecheck: npm run typecheck
  unit: npm test
  integration: npm run test:integration
  browser: npm run test:e2e
  build: npm run build
  security:
    - npm audit --audit-level=high
    - detect-secrets scan

verification:
  requireAllCommandsPass: true
  requireSecurityPass: true
  requirePOAcceptance: true
  requireRequirementCoverage: true
  allowOverride: true

roles:
  promptsDir: .agentic/prompts
  customRolesDir: .agentic/roles

prMonitor:
  enabled: true
  pollIntervalSeconds: 60
  fixCiFailures: true
  fixReviewComments: true
  requireApprovalForLargeFixes: true
```

---

## 21. CLI And IDE Flow
### CLI Commands
- `agentic init`
- `agentic intake github <issue-url>`
- `agentic intake manual`
- `agentic spec`
- `agentic decompose`
- `agentic approve`
- `agentic implement --candidates 4`
- `agentic verify`
- `agentic finalize`
- `agentic pr create`
- `agentic pr monitor`
- `agentic status`
- `agentic open-artifacts`
- `agentic cleanup`

### Cursor Flow
1. User runs `Agentic: Intake GitHub Issue`.
2. Cursor opens generated `spec.md`.
3. User approves or edits spec.
4. Cursor opens `decomposition.md`.
5. User approves decomposition by default.
6. Orchestrator spawns local worktrees.
7. Cursor shows live status.
8. Verifier produces reports.
9. User reviews chosen diff if configured.
10. Finalizer opens PR.
11. PR manager monitors comments and CI.

---

## 22. UX Flow
### Default Human-Gated Flow
1. User provides GitHub issue.
2. PO asks clarifying questions.
3. PO writes spec.
4. Task writer decomposes work.
5. User approves decomposition.
6. Agents implement in parallel.
7. Verifier checks candidates.
8. Failed candidates retry.
9. Best candidate is selected.
10. Finalizer creates PR.
11. PR manager handles comments/CI.

### Aggressive Autonomy Flow
1. User provides issue.
2. System generates spec/decomposition.
3. If confidence is high, proceeds without mandatory approval.
4. Runs candidates.
5. Verifies.
6. Creates PR if all gates pass and config permits.
7. Monitors PR.

### User Controls
- Pause run.
- Resume run.
- Approve gate.
- Skip gate.
- Reject candidate.
- Force retry.
- Pick candidate manually.
- Open worktree in Cursor.
- Open verification report.
- Create draft PR instead of ready PR.
- Stop PR monitor.

---

## 23. Rollout Plan
### Phase 1: Local Orchestrator Foundation
- Implement local CLI.
- Add config loading.
- Add run state directory.
- Add GitHub issue intake.
- Add manual task intake.
- Add spec and decomposition artifact generation.
- Add approval checkpoint.

### Phase 2: Worktree Parallelization
- Add worktree manager.
- Add candidate branch creation.
- Add local implementer runner.
- Add candidate summaries.
- Add cleanup/archive support.

### Phase 3: Deterministic Verification
- Add command runner.
- Add lint/typecheck/test/build/security command support.
- Add command logs and reports.
- Add pass/fail gating.

### Phase 4: Agentic Reviewers
- Add code reviewer.
- Add security reviewer.
- Add test reviewer.
- Add PO reviewer.
- Add edge-case reviewer.
- Add judge aggregator.
- Add requirement coverage matrix.

### Phase 5: Retry And Candidate Selection
- Add structured retry packets.
- Add retry limits.
- Add scoring.
- Add best-candidate selection.
- Add manual override.

### Phase 6: PR Finalization
- Add final branch creation.
- Add final full verification.
- Add PR body generation.
- Add GitHub PR creation.
- Add issue linking.

### Phase 7: PR Monitoring
- Add comment polling.
- Add CI/check polling.
- Add review comment classification.
- Add local fix loop.
- Add push/update flow.
- Add escalation policy.

### Phase 8: Cursor UX Polish
- Add Cursor commands/tasks.
- Add artifact opening.
- Add status views.
- Add prompt/config editing workflow.
- Add run dashboards if desired.

### Phase 9: Future Source Adapters
- Add Linear/Jira/Notion/local markdown adapters.
- Keep same PO/spec/decomposition interface.
- Preserve GitHub PR as final success output unless configured otherwise.

---

## 24. Pros And Cons
### Pros
- Fully local execution.
- Cursor remains the center of work.
- High customizability.
- Strong quality gates.
- Parallel candidate generation improves outcome quality.
- Worktrees isolate risk.
- Requirement traceability reduces missed acceptance criteria.
- PR monitoring keeps autonomy going after PR creation.
- Tool ideas are borrowed without surrendering control to another IDE agent.

### Cons
- More complex than a single-agent flow.
- Local machine resources can become a bottleneck.
- Local model quality may vary.
- Parallel worktrees can consume disk and time.
- Browser/integration tests may be flaky.
- PR monitoring needs careful guardrails.
- Strong verification can slow delivery.
- Cursor integration may require custom commands/tasks rather than a native extension at first.

---

## 25. Risks And Mitigations
`Risk: Local model underperforms.`
Mitigation: support role-specific models, candidate diversity, stronger deterministic verification, and manual fallback.

`Risk: Agents miss requirements.`
Mitigation: stable requirement IDs, PO reviewer, coverage matrix, blocking unverified requirements.

`Risk: Parallel candidates create noisy diffs.`
Mitigation: finalizer creates a clean branch from the selected candidate and reruns verification.

`Risk: Security issues slip through.`
Mitigation: mandatory security reviewer, static scans, secret scans, dependency checks, blocking high-severity findings.

`Risk: CI differs from local environment.`
Mitigation: PR manager monitors CI and loops fixes locally.

`Risk: User loses control.`
Mitigation: default approval after decomposition, configurable gates, pause/resume, manual candidate selection.

`Risk: Too much autonomy creates bad PRs.`
Mitigation: before-PR approval option, strict verifier, PR draft mode, and no auto-merge by default.

`Risk: Tool fragmentation.`
Mitigation: Cursor remains the only harness; Roo/Cline/Continue/Qodo are references or optional local integrations.

---

## 26. Success Definition
A task is successful when:

- A GitHub issue or manual task becomes an approved spec.
- Requirements are decomposed into implementation tasks.
- Multiple local worktree candidates are produced.
- At least one candidate passes deterministic verification.
- Agentic code, security, test, edge-case, and PO reviews pass.
- Requirement coverage is complete.
- A clean GitHub PR is created.
- PR body includes verification evidence.
- Local PR monitor is running or intentionally disabled.
- All execution occurred locally, with Cursor as the primary harness.
