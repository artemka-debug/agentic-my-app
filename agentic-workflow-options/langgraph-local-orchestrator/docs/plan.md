## LangGraph Local Orchestrator Spec

### 1. Executive Summary

Build a local LangGraph-based orchestration system that uses Cursor as the human-facing harness and local execution environment for autonomous GitHub issue implementation.

The system starts from a GitHub issue or manually supplied task, produces requirements through a Product Owner agent, decomposes the work into implementation tasks, fans out multiple local implementation agents across isolated git worktrees, verifies candidate solutions through automated and agentic review, selects or improves the best candidate, opens a GitHub PR, then continues monitoring CI and PR comments in the background.

No Cursor Cloud Agents. No cloud execution. All implementation, verification, testing, git operations, and agent work happen locally.

Success is a high-quality GitHub pull request that satisfies the approved requirements and passes configured verification gates.

---

## 2. Goals

- Implement GitHub issues through a mostly autonomous local agent workflow.
- Keep Cursor as the primary human-facing harness for task approval, progress visibility, review, and intervention.
- Use LangGraph for explicit graph control, state transitions, retries, branching, checkpointing, and resumability.
- Run all execution locally, including implementation agents, tests, browser tests, security checks, and git operations.
- Support parallel implementation attempts in separate worktrees.
- Require human approval after task decomposition by default.
- Allow configuration to disable mandatory gates for more aggressive autonomy.
- Preserve full requirement traceability from issue to spec to tasks to code changes to verification evidence.
- Include lint, typecheck, unit tests, integration tests, browser tests, code review, security review, edge-case review, and PO acceptance review.
- Open a GitHub PR as the definition of successful task completion.
- Continue monitoring PR comments and CI after opening the PR.

## 3. Non-Goals

These do not exclude any requested feature:

- The first version does not need to support non-GitHub task sources as first-class integrations, but the intake model must be source-agnostic so Linear, Notion, Jira, local markdown, or ad hoc prompts can be added later.
- The system does not need a hosted web dashboard in v1; Cursor, CLI output, local artifacts, logs, and optional generated reports are sufficient.
- The system does not rely on cloud execution or Cursor Cloud Agents.

---

## 4. Core Architecture

### 4.1 Components

- **Cursor Harness**
  - Human-facing control surface.
  - Used for approving requirements, approving decomposition, inspecting artifacts, and intervening when needed.
  - Local agents may be invoked through Cursor local runtime, Cursor CLI/SDK local mode, or local command wrappers, but never cloud mode.

- **LangGraph Orchestrator**
  - Owns graph execution, branching, retries, loops, checkpoints, and state.
  - Coordinates agents, worktrees, verification jobs, PR creation, and PR monitoring.

- **Local Agent Runner**
  - Runs role-specific agents locally.
  - Each implementation candidate gets an isolated worktree and agent workspace.
  - Agents receive constrained prompts, task context, requirements, repository context, and verification expectations.

- **GitHub Adapter**
  - Reads issues.
  - Adds issue comments if configured.
  - Creates branches and pull requests.
  - Monitors PR comments, reviews, requested changes, checks, and CI status.
  - Uses `gh` CLI or GitHub API locally with user credentials.

- **Verification Harness**
  - Runs configured commands locally.
  - Produces machine-readable results and human-readable summaries.
  - Includes tests, static checks, browser checks, code review, security review, and acceptance coverage.

- **Artifact Store**
  - Stores specs, requirements, task decomposition, prompts, transcripts, test outputs, diffs, review results, logs, and final PR metadata.

- **Checkpoint Store**
  - Persists LangGraph state so runs can resume after crashes, restarts, or manual pauses.

---

## 5. Graph Architecture

### 5.1 High-Level Graph

```text
Intake
  -> PO Clarification
  -> Requirement Spec
  -> Human Spec Approval? [default yes]
  -> Task Decomposition
  -> Human Decomposition Approval? [default yes]
  -> Worktree Fanout
  -> Parallel Implementers
  -> Candidate Verification
  -> Candidate Ranking
  -> Any Candidate Accepted?
      yes -> Finalization
      no  -> Repair Loop / Refanout
  -> PR Creation
  -> PR Monitoring Loop
  -> Done
```

### 5.2 Main Nodes

#### `intake_node`

Responsibilities:

- Accept task from GitHub issue first.
- Support future source adapters through a common `TaskSource` interface.
- Fetch issue title, body, labels, comments, linked PRs, assignees, milestone, project metadata, and attachments if available.
- Normalize task into canonical `TaskBrief`.

Outputs:

- `source`
- `task_brief`
- `repo_context`
- `initial_constraints`
- `source_artifacts`

#### `po_clarification_node`

Responsibilities:

- Act as Product Owner.
- Identify ambiguities, missing requirements, hidden constraints, user impact, edge cases, and acceptance criteria.
- Ask human clarifying questions when required.
- If configured for autonomous mode, infer reasonable assumptions and mark them explicitly.

Outputs:

- `clarifying_questions`
- `assumptions`
- `resolved_product_context`

#### `requirement_spec_node`

Responsibilities:

- Convert task brief and clarification into a full implementation spec.
- Define user-facing behavior, technical constraints, acceptance criteria, non-regression expectations, edge cases, and test expectations.
- Assign stable requirement IDs.

Outputs:

- `requirements_spec`
- `acceptance_criteria`
- `requirement_trace_index`

#### `spec_approval_node`

Responsibilities:

- Pause for human approval by default.
- Allow approve, edit, reject, or request clarification.
- Can be bypassed with config.

Outputs:

- `approved_spec`
- `approval_record`

#### `decomposition_node`

Responsibilities:

- Split approved spec into implementation tasks.
- Identify files/modules likely involved.
- Identify sequencing constraints.
- Define verification requirements per task.
- Create implementation plan variants if useful.

Outputs:

- `task_plan`
- `implementation_tasks`
- `candidate_strategy`

#### `decomposition_approval_node`

Responsibilities:

- Pause for human approval after decomposition by default.
- Allow user to approve, edit, reorder, reduce scope, increase autonomy, or change fanout count.
- Can be bypassed.

Outputs:

- `approved_task_plan`
- `approval_record`

#### `worktree_fanout_node`

Responsibilities:

- Create isolated git worktrees from the current base branch.
- Allocate one candidate branch per implementer.
- Prepare per-candidate artifact directories.
- Copy or reference approved requirements and task plan.
- Validate clean base state and dependency readiness.

Outputs:

- `candidate_worktrees`
- `candidate_branches`

#### `implementation_node`

Responsibilities:

- Run multiple implementation agents in parallel.
- Each agent works locally in its own worktree.
- Each agent gets the full spec, assigned strategy, repository context, and verification contract.
- Agents may run tests locally inside their worktree.
- Agents produce summary, changed files, rationale, and self-verification notes.

Outputs:

- `candidate_results`

#### `verification_node`

Responsibilities:

- Verify each candidate independently.
- Run configured checks.
- Run agentic code review.
- Run agentic security review.
- Run PO acceptance coverage review.
- Run edge-case analysis.
- Produce pass/fail and evidence per requirement.

Outputs:

- `verification_reports`

#### `candidate_ranking_node`

Responsibilities:

- Compare candidates by requirement coverage, test pass rate, diff quality, maintainability, risk, simplicity, and security posture.
- Select best candidate or request repairs.
- Optionally merge useful ideas from multiple candidates, but only through a controlled finalization step.

Outputs:

- `selected_candidate`
- `ranking_report`
- `repair_requests`

#### `repair_loop_node`

Responsibilities:

- Send failed or partial candidates back to implementers with verifier feedback.
- Retry within configured limits.
- Optionally spawn new candidates using lessons learned.
- Escalate to human if blocked.

Outputs:

- `updated_candidate_results`
- `retry_history`

#### `finalization_node`

Responsibilities:

- Move selected candidate to final branch.
- Clean up implementation artifacts from code.
- Ensure commit history policy is followed.
- Run final verification.
- Produce PR title and body from requirement traceability and verification evidence.

Outputs:

- `final_branch`
- `final_diff`
- `final_verification`
- `pr_draft`

#### `pr_creation_node`

Responsibilities:

- Push branch.
- Create GitHub PR.
- Link issue.
- Include summary, requirement coverage, test plan, risks, screenshots if applicable, and verification results.
- Apply labels/reviewers if configured.

Outputs:

- `pr_url`
- `pr_number`
- `pr_metadata`

#### `pr_monitor_node`

Responsibilities:

- Background loop after PR open.
- Monitor CI, PR review comments, requested changes, merge conflicts, and new issue comments.
- Triage comments.
- Resolve clear issues autonomously if configured.
- Ask human before risky changes if configured.
- Re-run verification after fixes.
- Keep PR updated until success, blocked, or stopped.

Outputs:

- `monitoring_events`
- `followup_commits`
- `ci_status`
- `review_resolution_status`

---

## 6. Graph Edges

### 6.1 Primary Edges

- `intake_node -> po_clarification_node`
- `po_clarification_node -> requirement_spec_node`
- `requirement_spec_node -> spec_approval_node`
- `spec_approval_node -> decomposition_node`
- `decomposition_node -> decomposition_approval_node`
- `decomposition_approval_node -> worktree_fanout_node`
- `worktree_fanout_node -> implementation_node`
- `implementation_node -> verification_node`
- `verification_node -> candidate_ranking_node`
- `candidate_ranking_node -> finalization_node` if accepted
- `candidate_ranking_node -> repair_loop_node` if repairable
- `repair_loop_node -> implementation_node`
- `finalization_node -> pr_creation_node`
- `pr_creation_node -> pr_monitor_node`
- `pr_monitor_node -> done` when complete or stopped

### 6.2 Conditional Edges

- `po_clarification_node -> human_question_node` when critical ambiguity exists and autonomy does not allow assumptions.
- `spec_approval_node -> requirement_spec_node` when user requests edits.
- `decomposition_approval_node -> decomposition_node` when user requests plan edits.
- `verification_node -> human_review_node` when verifier detects high-risk changes.
- `repair_loop_node -> failed_terminal_node` when retry budget is exhausted.
- `pr_monitor_node -> finalization_node` when PR comments require code changes.
- `pr_monitor_node -> blocked_terminal_node` when manual intervention is required.

---

## 7. Shared State Model

### 7.1 `OrchestratorState`

```typescript
type OrchestratorState = {
  runId: string;
  repo: RepoState;
  source: TaskSource;
  taskBrief: TaskBrief;
  requirements?: RequirementsSpec;
  taskPlan?: TaskPlan;
  approvals: ApprovalRecord[];
  candidates: CandidateState[];
  verificationReports: VerificationReport[];
  selectedCandidateId?: string;
  finalization?: FinalizationState;
  pullRequest?: PullRequestState;
  monitor?: PrMonitorState;
  config: OrchestratorConfig;
  artifacts: ArtifactIndex;
  errors: ErrorRecord[];
  checkpoints: CheckpointMetadata[];
};
```

### 7.2 `TaskSource`

```typescript
type TaskSource = {
  kind: "github_issue" | "manual" | "future";
  id: string;
  url?: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
};
```

### 7.3 `Requirement`

```typescript
type Requirement = {
  id: string; // REQ-001
  title: string;
  description: string;
  sourceRefs: SourceRef[];
  acceptanceCriteria: AcceptanceCriterion[];
  edgeCases: EdgeCase[];
  priority: "must" | "should" | "could";
  verificationMethods: VerificationMethod[];
  status: "draft" | "approved" | "implemented" | "verified" | "failed";
};
```

### 7.4 `CandidateState`

```typescript
type CandidateState = {
  id: string;
  branch: string;
  worktreePath: string;
  assignedStrategy: string;
  agentRunIds: string[];
  status:
    | "pending"
    | "implementing"
    | "implemented"
    | "verifying"
    | "accepted"
    | "repairing"
    | "rejected"
    | "failed";
  changedFiles: string[];
  commits: string[];
  summary?: string;
  selfReview?: string;
  verificationReportIds: string[];
  retryCount: number;
};
```

---

## 8. Local Worktree Fanout

### 8.1 Worktree Layout

```text
.repo/
.worktrees/
  run-<runId>/
    candidate-a/
    candidate-b/
    candidate-c/
.artifacts/
  runs/<runId>/
    spec.md
    requirements.json
    task-plan.md
    candidates/
      candidate-a/
        prompt.md
        transcript.jsonl
        diff.patch
        test-output/
        verification.json
```

### 8.2 Branch Naming

```text
agent/<issue-number>-<slug>/candidate-a
agent/<issue-number>-<slug>/candidate-b
agent/<issue-number>-<slug>/candidate-c
agent/<issue-number>-<slug>/final
```

### 8.3 Fanout Policy

Configurable:

- `fanout.count`: number of parallel implementers.
- `fanout.strategy`: `same_plan`, `diverse_strategies`, `risk_split`, or `model_diverse`.
- `fanout.maxConcurrent`: local concurrency limit.
- `fanout.baseRef`: default branch or provided base branch.
- `fanout.cleanup`: preserve, archive, or delete worktrees after finalization.

### 8.4 Candidate Isolation Rules

- Each candidate gets its own worktree and branch.
- No candidate may modify another candidate’s worktree.
- Shared artifacts are read-only to implementers.
- Verification writes only to artifact directories.
- Finalization chooses one candidate branch or creates a new final branch.

---

## 9. Cursor Integration Points

### 9.1 Cursor as Harness

Cursor is used for:

- Starting the orchestration from chat or terminal.
- Reviewing generated requirements.
- Approving or editing decomposition.
- Showing progress summaries.
- Opening artifacts in the editor.
- Inspecting candidate diffs.
- Performing manual interventions.
- Reviewing final PR draft.
- Continuing local work if the orchestrator pauses.

### 9.2 Local Agent Execution

Allowed execution modes:

- Cursor local runtime through the Cursor TypeScript SDK with `local: { cwd }`.
- Cursor CLI local execution if exposed and stable.
- Local subprocess wrappers around agent commands.
- LangGraph nodes that call local model/agent providers.

Required constraints:

- Explicitly configure local runtime.
- Never pass cloud runtime options.
- Never use auto PR creation from cloud agents.
- PR creation is done locally via `gh` or GitHub API.
- All worktrees are local filesystem paths.

### 9.3 Human Gates in Cursor

Default gates:

- Approve requirements/spec.
- Approve task decomposition.
- Optional final PR draft review.

Configurable autonomy:

```yaml
approvals:
  requireSpecApproval: true
  requireDecompositionApproval: true
  requireFinalPrApproval: false
  allowAssumptionsWithoutClarification: false
```

Aggressive mode:

```yaml
approvals:
  requireSpecApproval: false
  requireDecompositionApproval: false
  requireFinalPrApproval: false
  allowAssumptionsWithoutClarification: true
```

---

## 10. Agent Roles and Prompt Contracts

### 10.1 Product Owner Agent

Purpose:

- Convert vague task input into clear requirements.
- Identify ambiguity.
- Define acceptance criteria.
- Preserve user intent.

Prompt contract:

```text
You are the Product Owner agent.

Your job is to transform the task source into approved implementation requirements.

You must:
- Preserve all explicit user and issue requirements.
- Identify ambiguous, missing, or conflicting requirements.
- Ask clarifying questions when necessary unless autonomy mode allows assumptions.
- Write requirements with stable IDs.
- Include acceptance criteria, edge cases, non-regression expectations, and verification hints.
- Do not design implementation details unless required to clarify behavior.
- Mark assumptions explicitly.
```

Outputs:

- `requirements.md`
- `requirements.json`
- `clarifying_questions.md`

### 10.2 Task Decomposition Agent

Purpose:

- Convert requirements into implementation tasks.

Prompt contract:

```text
You are the task decomposition agent.

You must:
- Split approved requirements into concrete implementation tasks.
- Map each task to requirement IDs.
- Identify likely files, modules, tests, and dependencies.
- Define task order and parallelization opportunities.
- Define risks and verification needs.
- Produce a plan suitable for multiple implementers.
```

Outputs:

- `task-plan.md`
- `task-plan.json`

### 10.3 Implementation Agents

Purpose:

- Implement candidate solutions.

Prompt contract:

```text
You are a local implementation agent working in an isolated git worktree.

You must:
- Implement the approved task plan.
- Satisfy every must requirement.
- Keep changes focused and consistent with the repository.
- Add or update tests appropriate to the change.
- Run relevant verification commands when possible.
- Record what changed, why, and how requirements are satisfied.
- Do not create a PR.
- Do not modify files outside this worktree.
```

Outputs:

- Code changes.
- Candidate summary.
- Self-review.
- Requirement coverage notes.
- Test outputs.

### 10.4 Verifier Agent

Purpose:

- Judge candidate correctness.

Prompt contract:

```text
You are the verifier agent.

You must:
- Verify the candidate against every requirement and acceptance criterion.
- Review tests, edge cases, code quality, maintainability, and regression risk.
- Run configured local verification commands.
- Produce pass/fail status per requirement.
- Identify missing tests and risky assumptions.
- Recommend accept, repair, or reject.
```

Outputs:

- `verification-report.json`
- `verification-report.md`

### 10.5 Code Review Agent

Purpose:

- Independent review of candidate diff.

Checks:

- Correctness.
- Simplicity.
- Maintainability.
- Repository conventions.
- Error handling.
- API compatibility.
- Data migration risk.
- Race conditions.
- Concurrency bugs.
- Test adequacy.

### 10.6 Security Review Agent

Purpose:

- Dedicated security pass.

Checks:

- Secrets exposure.
- Auth/authz regressions.
- Injection risks.
- Unsafe shell execution.
- Path traversal.
- SSRF.
- XSS.
- CSRF.
- Dependency risk.
- Data leakage.
- Insecure logging.
- Permission expansion.
- Supply-chain risk.

### 10.7 PO Acceptance Agent

Purpose:

- Product-level acceptance review.

Checks:

- Does the implementation satisfy the user-facing intent?
- Are all acceptance criteria covered?
- Are edge cases addressed?
- Are assumptions still valid?
- Does the PR description explain behavior clearly?

### 10.8 Finalization Agent

Purpose:

- Prepare selected candidate for PR.

Responsibilities:

- Ensure final branch is clean.
- Run final verification.
- Compose PR title/body.
- Link issue.
- Summarize requirements coverage.
- Include test plan and risk notes.

### 10.9 PR Manager Agent

Purpose:

- Monitor PR after opening.

Responsibilities:

- Watch CI.
- Watch review comments.
- Classify comments as required, optional, unclear, or stale.
- Apply clear fixes locally.
- Ask for human input on ambiguous/risky changes.
- Push follow-up commits.
- Keep PR status updated.

---

## 11. GitHub Issue Intake and PR Creation

### 11.1 Issue Intake

Use `gh` CLI or GitHub API:

```bash
orchestrator issue start OWNER/REPO#123
orchestrator issue start https://github.com/OWNER/REPO/issues/123
```

Collected data:

- Issue title.
- Issue body.
- Labels.
- Comments.
- Assignees.
- Milestone.
- Linked PRs.
- Project fields if available.
- Reactions only if useful for priority.
- Referenced files, logs, screenshots, or reproduction steps.

Normalized into:

```json
{
  "kind": "github_issue",
  "id": "OWNER/REPO#123",
  "url": "https://github.com/OWNER/REPO/issues/123",
  "title": "...",
  "body": "...",
  "metadata": {
    "labels": [],
    "comments": [],
    "assignees": [],
    "milestone": null
  }
}
```

### 11.2 PR Creation

The finalization agent creates a PR using local credentials:

```bash
gh pr create \
  --title "<title>" \
  --body-file ".artifacts/runs/<runId>/pr-body.md" \
  --base "<base>" \
  --head "<final-branch>"
```

PR body must include:

- Linked issue.
- Summary.
- Requirement coverage.
- Verification results.
- Test plan.
- Screenshots or recordings for UI changes.
- Risk notes.
- Known limitations if any.
- Reviewer guidance.

---

## 12. Requirement Traceability Model

### 12.1 IDs

Use stable IDs:

- `REQ-001`: Requirement.
- `AC-001.1`: Acceptance criterion.
- `EC-001.1`: Edge case.
- `TASK-001`: Implementation task.
- `TEST-001`: Verification item.
- `FINDING-001`: Review finding.

### 12.2 Traceability Matrix

Each candidate must produce:

```json
{
  "requirements": [
    {
      "id": "REQ-001",
      "implementedBy": ["TASK-001", "commit-sha", "file.ts"],
      "verifiedBy": ["unit:test-name", "browser:flow-name", "review:PO"],
      "status": "verified",
      "evidence": ["path/to/test-output.txt", "path/to/review.md"]
    }
  ]
}
```

### 12.3 Required Trace Links

- Issue source to requirement.
- Requirement to task.
- Task to changed files.
- Requirement to tests.
- Requirement to verifier result.
- Requirement to PR body.

---

## 13. Verifier Design

### 13.1 Verification Layers

Every candidate goes through:

1. **Static checks**
   - Formatting.
   - Lint.
   - Typecheck.
   - Dependency validation.

2. **Automated tests**
   - Unit tests.
   - Integration tests.
   - Browser/e2e tests.
   - Snapshot or visual tests when applicable.

3. **Agentic review**
   - Code review.
   - Security review.
   - PO acceptance review.
   - Edge-case review.

4. **Traceability review**
   - Every `must` requirement has implementation evidence.
   - Every acceptance criterion has verification evidence.
   - No untested high-risk behavior.

### 13.2 Verification Report

```typescript
type VerificationReport = {
  candidateId: string;
  status: "pass" | "fail" | "needs_repair";
  score: number;
  commandResults: CommandResult[];
  requirementResults: RequirementResult[];
  codeReview: ReviewResult;
  securityReview: ReviewResult;
  poReview: ReviewResult;
  edgeCaseReview: ReviewResult;
  missingCoverage: string[];
  repairInstructions: string[];
};
```

### 13.3 Candidate Scoring

Suggested scoring:

- Requirement satisfaction: 35%.
- Test pass and coverage: 25%.
- Code quality: 15%.
- Security: 10%.
- Maintainability/simplicity: 10%.
- PR readiness: 5%.

A candidate cannot pass if:

- Any `must` requirement fails.
- Security review finds a critical issue.
- Required test suite fails.
- Typecheck fails.
- It includes unrelated or destructive changes.
- It cannot be cleanly turned into a PR.

---

## 14. PO Acceptance Criteria Checking

The PO acceptance agent checks product intent independently from implementation quality.

It must answer:

- Does this solve the original issue?
- Are all `must` requirements satisfied?
- Are user-visible behaviors correct?
- Are edge cases handled?
- Did implementation introduce behavior that conflicts with the issue?
- Is the PR understandable to a reviewer?
- Are assumptions still acceptable?

Output:

```json
{
  "status": "pass",
  "requirementCoverage": {
    "REQ-001": "pass",
    "REQ-002": "fail"
  },
  "notes": [],
  "requiredRepairs": []
}
```

---

## 15. Tests and Edge-Case Coverage Strategy

### 15.1 Test Selection

The decomposition agent proposes tests. The verifier confirms or expands them.

Supported command classes:

```yaml
verification:
  commands:
    format: "npm run format:check"
    lint: "npm run lint"
    typecheck: "npm run typecheck"
    unit: "npm test"
    integration: "npm run test:integration"
    browser: "npm run test:e2e"
```

Commands are repo-configurable and optional only when explicitly disabled.

### 15.2 Dynamic Test Discovery

The verifier should inspect the repo for:

- Package manager.
- Existing scripts.
- Test framework.
- Browser test framework.
- Monorepo packages.
- Changed-file ownership.
- Relevant existing tests.

### 15.3 Edge-Case Review

For each requirement, define:

- Empty input.
- Invalid input.
- Boundary values.
- Permission boundaries.
- Network failure.
- Retry/idempotency behavior.
- Concurrency behavior.
- Persistence and migration concerns.
- Backward compatibility.
- UI loading/error states.
- Accessibility considerations for UI changes.

---

## 16. Security Review Strategy

### 16.1 Static Security Checks

Configurable commands:

```yaml
security:
  commands:
    secrets: "gitleaks detect --source ."
    deps: "npm audit --audit-level=high"
    semgrep: "semgrep --config auto"
```

### 16.2 Agentic Security Review

The security agent must inspect:

- Full diff.
- Threat model for changed area.
- New dependencies.
- New environment variables.
- Auth and permission checks.
- User-controlled inputs.
- File/network/process boundaries.
- Logging and telemetry changes.

### 16.3 Blocking Conditions

Block PR creation or require human approval when:

- Secret exposure is detected.
- Critical/high dependency vulnerability is introduced.
- Authz behavior changes without explicit requirement.
- User input reaches shell/database/template execution unsafely.
- Sensitive data is logged.
- The agent cannot determine security impact.

---

## 17. PR Monitoring Loop

### 17.1 Events

Monitor:

- CI status.
- Review comments.
- PR review state.
- Requested changes.
- Merge conflicts.
- New commits on base branch.
- New issue comments if linked issue remains active.

### 17.2 Loop

```text
Poll or receive event
  -> classify event
  -> decide action
  -> if code change needed, checkout final branch
  -> apply local fix
  -> run targeted verification
  -> push follow-up commit
  -> update PR comment/status
  -> continue until done/blocked/stopped
```

### 17.3 Comment Classification

- `must_fix`: clear correctness or CI issue.
- `should_fix`: quality improvement likely worth doing.
- `question`: needs response or clarification.
- `nit`: optional.
- `unclear`: ask human.
- `out_of_scope`: respond with rationale or ask human.

### 17.4 Autonomy Policy

```yaml
prMonitor:
  enabled: true
  pollIntervalSeconds: 60
  autoFixCi: true
  autoFixReviewComments: true
  requireHumanFor:
    - security_sensitive_changes
    - public_api_changes
    - migration_changes
    - ambiguous_reviewer_requests
```

---

## 18. State Persistence and Checkpointing

### 18.1 Checkpoint Store

Use SQLite for local durability.

Tables:

- `runs`
- `graph_checkpoints`
- `approvals`
- `candidates`
- `verification_reports`
- `events`
- `errors`
- `artifacts`

### 18.2 Checkpoint Boundaries

Checkpoint after:

- Intake complete.
- Requirements generated.
- Approval decisions.
- Decomposition complete.
- Worktrees created.
- Each implementation completes.
- Each verification completes.
- Candidate selected.
- PR created.
- Every PR monitor event.

### 18.3 Resume

Commands:

```bash
orchestrator run resume <runId>
orchestrator run status <runId>
orchestrator run abort <runId>
```

Resume must restore:

- Graph node.
- State.
- Worktree paths.
- Candidate branches.
- Agent run IDs where available.
- Pending approvals.
- PR monitoring state.

---

## 19. Logging and Artifacts

### 19.1 Artifact Types

Store:

- Raw issue payload.
- Clarification transcript.
- Requirements spec.
- Task plan.
- Human approvals.
- Agent prompts.
- Agent transcripts.
- Candidate diffs.
- Test outputs.
- Browser test artifacts.
- Screenshots/videos.
- Verification reports.
- Security reports.
- PR body.
- PR monitoring log.

### 19.2 Log Format

Use structured JSONL:

```json
{
  "timestamp": "2026-05-08T15:00:00Z",
  "runId": "run_123",
  "node": "verification",
  "candidateId": "candidate-a",
  "level": "info",
  "event": "command_finished",
  "data": {
    "command": "npm test",
    "exitCode": 0
  }
}
```

### 19.3 Human Summaries

Also generate markdown summaries:

- `run-summary.md`
- `requirements.md`
- `task-plan.md`
- `candidate-ranking.md`
- `verification-summary.md`
- `pr-monitor-summary.md`

---

## 20. Failure and Retry Policy

### 20.1 Failure Classes

- `transient`: command timeout, temporary network, flaky test.
- `agent_failure`: agent run failed or produced invalid output.
- `verification_failure`: candidate does not satisfy requirements.
- `environment_failure`: missing dependency, broken local setup.
- `merge_failure`: conflict or base branch movement.
- `approval_rejection`: human rejected spec/plan.
- `security_blocker`: critical risk found.

### 20.2 Retry Rules

```yaml
retry:
  agentRunMaxAttempts: 2
  implementationRepairMaxAttempts: 3
  commandRetryMaxAttempts: 1
  flakyTestRetryMaxAttempts: 2
  refanoutOnTotalFailure: true
```

### 20.3 Escalation

Escalate to human when:

- Approval is rejected.
- All candidates fail after retry budget.
- Security blocker is found.
- Local environment is broken.
- PR reviewer request is ambiguous.
- Merge conflict is complex.
- Verification cannot determine correctness.

---

## 21. Config Schema

Example `orchestrator.config.yaml`:

```yaml
repo:
  root: "."
  baseBranch: "main"
  remote: "origin"

runtime:
  execution: "local"
  cursor:
    enabled: true
    sdkLocal: true
    model: "auto"
    settingSources: []

sources:
  github:
    enabled: true
    cli: "gh"

approvals:
  requireSpecApproval: true
  requireDecompositionApproval: true
  requireFinalPrApproval: false
  allowAssumptionsWithoutClarification: false

fanout:
  count: 3
  maxConcurrent: 3
  strategy: "diverse_strategies"
  cleanup: "preserve_on_failure_archive_on_success"

verification:
  required:
    lint: true
    typecheck: true
    unit: true
    integration: true
    browser: true
    codeReview: true
    securityReview: true
    poReview: true
  commands:
    lint: "npm run lint"
    typecheck: "npm run typecheck"
    unit: "npm test"
    integration: "npm run test:integration"
    browser: "npm run test:e2e"
  timeouts:
    commandSeconds: 900

security:
  commands:
    secrets: "gitleaks detect --source ."
    deps: "npm audit --audit-level=high"
    semgrep: "semgrep --config auto"
  blockOnHigh: true

pr:
  createDraft: false
  labels: ["agentic"]
  reviewers: []
  bodyTemplate: ".orchestrator/templates/pr.md"

prMonitor:
  enabled: true
  pollIntervalSeconds: 60
  autoFixCi: true
  autoFixReviewComments: true
  maxFollowupCommits: 10

persistence:
  sqlitePath: ".orchestrator/state.sqlite"
  artifactDir: ".orchestrator/artifacts"

logging:
  level: "info"
  jsonl: true
```

---

## 22. CLI Commands

### 22.1 Primary Commands

```bash
orchestrator issue start OWNER/REPO#123
orchestrator issue start https://github.com/OWNER/REPO/issues/123
orchestrator task start --file task.md
orchestrator run status <runId>
orchestrator run resume <runId>
orchestrator run abort <runId>
```

### 22.2 Approval Commands

```bash
orchestrator approve spec <runId>
orchestrator edit spec <runId>
orchestrator approve plan <runId>
orchestrator edit plan <runId>
```

### 22.3 Candidate Commands

```bash
orchestrator candidates list <runId>
orchestrator candidates diff <runId> <candidateId>
orchestrator candidates verify <runId> <candidateId>
orchestrator candidates select <runId> <candidateId>
```

### 22.4 PR Commands

```bash
orchestrator pr create <runId>
orchestrator pr monitor <runId>
orchestrator pr stop-monitor <runId>
```

### 22.5 Utility Commands

```bash
orchestrator config validate
orchestrator doctor
orchestrator artifacts open <runId>
orchestrator cleanup <runId>
```

---

## 23. UX Flow

### 23.1 Default Human-Gated Flow

1. User starts from Cursor:

   ```bash
   orchestrator issue start OWNER/REPO#123
   ```

2. PO agent reads the issue and generates requirements.

3. Cursor shows:

   - Summary.
   - Clarifying questions if needed.
   - Requirements.
   - Acceptance criteria.
   - Assumptions.

4. User approves or edits spec.

5. Decomposition agent creates implementation plan.

6. Cursor shows:

   - Tasks.
   - Candidate strategy.
   - Fanout count.
   - Verification plan.

7. User approves or edits decomposition.

8. Orchestrator creates worktrees and runs implementers.

9. Verifier evaluates all candidates.

10. Best candidate is selected or repaired.

11. Finalization agent creates PR.

12. PR manager monitors CI and comments.

### 23.2 Aggressive Autonomous Flow

```bash
orchestrator issue start OWNER/REPO#123 --autonomous
```

Behavior:

- No mandatory approval gates.
- PO agent may make explicit assumptions.
- Decomposition proceeds automatically.
- PR can be created automatically after verification.
- Human is only interrupted for configured blockers.

---

## 24. Rollout Plan

### Phase 1: Local Skeleton

- Create CLI.
- Add config loading and validation.
- Add SQLite checkpoint store.
- Add artifact store.
- Add LangGraph state and basic graph.
- Implement manual task intake.
- Implement status/resume/abort.

### Phase 2: GitHub Issue Intake

- Add `gh` integration.
- Fetch issue metadata.
- Normalize to `TaskBrief`.
- Store source artifacts.
- Add source abstraction for future adapters.

### Phase 3: PO and Requirements

- Implement PO clarification node.
- Implement requirements spec generation.
- Add requirement IDs and traceability model.
- Add human approval flow in Cursor/CLI.

### Phase 4: Decomposition

- Implement task decomposition node.
- Generate task plan and candidate strategies.
- Add decomposition approval gate.
- Add configurable autonomy.

### Phase 5: Worktree Fanout

- Create isolated worktrees.
- Create candidate branches.
- Add fanout strategy config.
- Add cleanup/archive policy.

### Phase 6: Local Implementation Agents

- Add local Cursor runtime or local agent runner.
- Run candidates in parallel.
- Capture prompts, transcripts, diffs, and summaries.
- Enforce worktree isolation.

### Phase 7: Verification Harness

- Add command runner.
- Add lint/typecheck/unit/integration/browser test support.
- Add structured command results.
- Add verifier report schema.

### Phase 8: Agentic Reviews

- Add code review agent.
- Add security review agent.
- Add PO acceptance agent.
- Add edge-case review agent.
- Add candidate scoring and ranking.

### Phase 9: Repair Loop

- Add verifier-to-implementer feedback loop.
- Add retry budgets.
- Add refanout behavior.
- Add escalation states.

### Phase 10: Finalization and PR Creation

- Select candidate.
- Create final branch.
- Run final verification.
- Generate PR title/body.
- Push branch.
- Create PR via `gh`.

### Phase 11: PR Monitoring

- Poll PR comments and CI.
- Classify review comments.
- Auto-fix clear CI and review issues.
- Push follow-up commits.
- Escalate risky or ambiguous requests.

### Phase 12: Hardening

- Add robust resume behavior.
- Add environment doctor.
- Add failure dashboards/reports.
- Add cleanup commands.
- Add repository templates.
- Add documentation and examples.

---

## 25. Risks and Mitigations

### Risk: Local environment drift

Mitigation:

- Add `orchestrator doctor`.
- Capture environment metadata.
- Prefer repo-defined scripts.
- Fail clearly on missing dependencies.

### Risk: Agents make broad unrelated changes

Mitigation:

- Worktree isolation.
- Diff scope review.
- Requirement traceability.
- Verifier blocks unrelated changes.

### Risk: Verification is slow

Mitigation:

- Run targeted tests first.
- Cache dependency installs.
- Parallelize candidates with concurrency limits.
- Run full verification only on finalists if configured.

### Risk: Flaky tests cause bad rejection

Mitigation:

- Flaky retry policy.
- Record repeated outputs.
- Distinguish deterministic failure from flaky failure.

### Risk: Security issue slips through

Mitigation:

- Dedicated security review.
- Static security tools.
- Block high-risk categories.
- Human escalation for uncertain security impact.

### Risk: PR monitor over-applies reviewer comments

Mitigation:

- Comment classification.
- Human gate for ambiguous/risky changes.
- Max follow-up commit budget.
- Full verification after follow-up changes.

### Risk: Parallel worktrees consume disk/CPU

Mitigation:

- Configurable concurrency.
- Cleanup policy.
- Artifact retention limits.
- Per-command timeouts.

---

## 26. Pros and Cons

### Pros

- Fully local execution.
- Cursor remains the main human interface.
- Highly customizable.
- Strong quality gates.
- Parallel candidates improve solution quality.
- Requirement traceability makes reviews more reliable.
- LangGraph gives explicit control over loops, retries, and checkpoints.
- GitHub PR remains the concrete success artifact.

### Cons

- More local setup complexity than a cloud agent.
- Parallel worktrees can be resource-intensive.
- Verification can be slow for large repos.
- Requires careful prompt and config design.
- PR monitoring loop needs conservative autonomy controls.
- Browser and integration tests may require significant local environment setup.

---

## 27. Definition of Done

A run is successful when:

- Requirements are approved or autonomy policy allows proceeding.
- Decomposition is approved or autonomy policy allows proceeding.
- At least one candidate satisfies all `must` requirements.
- Required verification passes.
- Code review, security review, and PO acceptance pass.
- A final branch is pushed.
- A GitHub PR is created.
- PR body includes traceability and verification evidence.
- PR monitor is active or explicitly disabled.

Final output to the user:

```text
PR created: https://github.com/OWNER/REPO/pull/456
Status: verification passed
Requirements: 12/12 satisfied
Tests: lint, typecheck, unit, integration, browser passed
Monitoring: enabled
```
