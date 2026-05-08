## Specification: Cursor-Local Agentic Implementation Workflow

### Goal
Build a fully local, Cursor-centered agentic workflow that turns approved GitHub issues into high-quality pull requests. The workflow uses BMAD Method and Agent OS only as process, specification, context, and prompt frameworks. Cursor remains the execution harness. No cloud agents, remote execution runners, hosted orchestration, or cloud-managed coding agents are required or allowed.

A successful task produces a GitHub PR with implementation, tests, verification artifacts, requirement coverage, and an active background monitoring loop for CI and review comments.

## Guiding Principles
All implementation runs locally on the developer machine through Cursor, local shell commands, local git worktrees, and local browser automation where needed.

BMAD contributes role discipline, lifecycle thinking, PO/PM/architect/developer/reviewer personas, readiness checks, story structure, and implementation review loops.

Agent OS contributes the lightweight spec-driven file model: standards, product context, per-feature specs, requirements, and task decomposition.

The system should optimize for customizability, quality, traceability, and aggressive autonomy after task approval. Human approval after decomposition is the default, but every gate must be configurable.

## BMAD vs Agent OS Fit
### BMAD Strengths
BMAD is better for multi-role product and engineering process. It maps naturally to Product Owner, Architect, Developer, QA, and Reviewer agents. It is useful when tasks are ambiguous, cross-functional, or require a strong “what are we really building?” phase.

Best adapted pieces:

- Product Owner and analyst-style clarification
- PRD/story readiness checks
- Architecture decision prompts
- Developer story execution prompts
- Code review and correct-course loops
- Sprint/story status tracking

### Agent OS Strengths
Agent OS is better as a lightweight spec and context operating system. Its Standards, Product, and Specs layering maps cleanly into repo-local files that Cursor agents can read.

Best adapted pieces:

- `standards/` for coding conventions and quality expectations
- `product/` for mission, roadmap, stack, and domain context
- `specs/<task>/requirements.md`
- `specs/<task>/spec.md`
- `specs/<task>/tasks.md`
- Task groups by specialty
- Implementation commands as reusable prompts

### Recommended Combination
Use Agent OS as the persistent file structure and spec substrate. Use BMAD as the role/process layer that governs who writes, reviews, decomposes, verifies, and corrects the work.

In practical terms:

- Agent OS defines the artifacts.
- BMAD defines the agents and ceremonies.
- Cursor Skills/Rules/Hooks make both executable inside Cursor.
- Local scripts coordinate worktrees, GitHub issue intake, verification, and PR finalization.

## Cursor Adaptation
### Cursor Rules
Use rules for persistent project behavior:

- Local-only execution policy
- Repo-specific coding conventions
- Test expectations
- Security review requirements
- PR quality bar
- Git/worktree safety rules
- Requirement traceability format

Suggested rules:

- `.cursor/rules/local-agentic-workflow.md`
- `.cursor/rules/quality-bar.md`
- `.cursor/rules/security-review.md`
- `.cursor/rules/github-pr-policy.md`
- `.cursor/rules/worktree-safety.md`

### Cursor Skills
Use Skills for reusable workflows:

- `github-issue-intake`
- `po-spec-clarification`
- `task-decomposition`
- `local-worktree-implementation`
- `candidate-verification`
- `po-acceptance-check`
- `security-review`
- `finalize-pr`
- `pr-babysit`

Each skill should contain role instructions, required inputs, output artifact schemas, and failure handling.

### Cursor Hooks
Use hooks for automation around agent events:

- Before implementation: verify clean base branch and create run directory.
- Before shell commands: block cloud-agent commands and destructive git commands.
- After candidate completion: run configured verification suite.
- After PR creation: start PR monitoring checklist.
- On task completion: write summary artifacts and traceability report.

Hooks should enforce policy, not hide important decisions.

## Architecture
### Components
The system consists of:

- Cursor as the primary human/agent interface.
- Local orchestrator script or command wrapper.
- Local git worktree manager.
- GitHub CLI integration for issues, branches, PRs, comments, and CI.
- Agent artifact directory in the repository.
- Cursor Skills/Rules/Hooks for repeatable behavior.
- Verification runner for lint, typecheck, tests, browser tests, review, security, and PO coverage.
- PR monitor that periodically checks GitHub comments, requested changes, and CI status.

### High-Level Flow
1. User provides a task, preferably a GitHub issue URL or issue number.
2. Intake agent fetches issue metadata and linked context.
3. Product Owner agent clarifies ambiguity and writes requirements.
4. Spec agent writes a formal implementation specification.
5. Task decomposition agent splits work into implementation task groups.
6. Human approval gate appears by default.
7. Local implementation agents run in parallel worktrees.
8. Verifier evaluates each candidate.
9. Failed candidates loop back with targeted feedback.
10. Winning candidate is finalized.
11. Finalization agent creates a PR.
12. Background reviewer/manager monitors CI and review comments until merge-ready.

## Repository Artifact Layout
Recommended local artifact structure:

```text
.agentic/
  config.yaml
  runs/
    <run-id>/
      intake.json
      requirements.md
      spec.md
      tasks.md
      decomposition.json
      approval.json
      worktrees.json
      candidates/
        candidate-a/
          task-assignment.md
          implementation-log.md
          verification-report.md
          requirement-coverage.json
          security-review.md
          code-review.md
        candidate-b/
      final/
        selected-candidate.md
        pr-body.md
        final-verification.md
        traceability.md
        handoff.md
  templates/
    prompts/
    reports/
```

Agent OS-compatible project context can live in:

```text
agent-os/
  standards/
  product/
  specs/
    <yyyy-mm-dd-issue-slug>/
      planning/requirements.md
      spec.md
      tasks.md
```

The implementation may mirror artifacts into both locations, or use `agent-os/specs/` as the canonical spec location and `.agentic/runs/` as the execution log.

## GitHub Issue Intake
### Inputs
The intake layer accepts:

- GitHub issue URL
- `owner/repo#number`
- Plain task text
- Future source adapters, such as Linear, Notion, Jira, Slack, or local markdown

GitHub is first-class for v1.

### GitHub Data Collected
For a GitHub issue, collect:

- Title
- Body
- Labels
- Assignees
- Milestone
- Comments
- Linked PRs
- Linked issues
- Project metadata where available
- Recent commits or files mentioned
- Reactions only if useful for priority or ambiguity
- Screenshots or attached assets when accessible

### Intake Output
`intake.json` should include:

```json
{
  "source": "github",
  "repository": "owner/repo",
  "issue_number": 123,
  "title": "Issue title",
  "body": "...",
  "labels": [],
  "comments": [],
  "linked_references": [],
  "initial_risk": "low|medium|high",
  "ambiguities": [],
  "suggested_workflow_depth": "quick|standard|full"
}
```

## PO, Spec, and Decomposition Workflow
### Product Owner Agent
Responsibilities:

- Convert issue text into clear user-facing requirements.
- Ask clarifying questions when needed.
- Identify assumptions, non-goals, constraints, and acceptance criteria.
- Preserve user intent rather than overfitting to implementation guesses.
- Decide whether work can proceed autonomously.

Outputs:

- `requirements.md`
- Requirement IDs such as `REQ-001`
- Acceptance criteria IDs such as `AC-001`
- Open questions
- Approval recommendation

If aggressive autonomy is enabled and ambiguity is below threshold, the PO may proceed with documented assumptions.

### Spec Agent
Responsibilities:

- Turn requirements into an implementation-ready spec.
- Identify affected subsystems.
- Capture reusable components and existing patterns.
- Define data model, API, UI, migration, compatibility, and testing implications.
- Include edge cases and security considerations.

Outputs:

- `spec.md`
- Technical approach
- File/module candidates
- Test strategy
- Risk assessment
- Traceability seed

### Task Decomposition Agent
Responsibilities:

- Split the spec into parallelizable work packages.
- Group by specialty: backend, frontend, data, tests, infra, docs, migration, browser verification.
- Identify dependencies and conflicts.
- Create candidate strategies for parallel implementation agents.

Outputs:

- `tasks.md`
- `decomposition.json`
- Worktree assignment plan
- Required validation per task group

Default gate: user approves decomposition before implementation begins.

Configurable modes:

- `approval.required_after_decomposition: true`
- `approval.allow_autorun_for_low_risk: true`
- `approval.max_autonomy_risk: medium`

## Local Worktree Strategy
Each implementation candidate gets a separate local git worktree from the same base commit.

Branch naming:

```text
agentic/<issue-number>-<slug>/<candidate-id>
```

Worktree naming:

```text
../.agentic-worktrees/<repo-name>/<run-id>/<candidate-id>
```

Candidate modes:

- `competitive`: multiple agents solve the same task independently; verifier picks the best.
- `partitioned`: agents work on separate task groups; finalizer merges compatible outputs.
- `hybrid`: partition obvious subtasks, run competing candidates for risky subtasks.

Recommended default:

- Low-risk task: one candidate.
- Medium-risk task: two candidates or one partitioned plan.
- High-risk task: two to three candidates plus stricter verification.

Worktree policy:

- Never modify the user’s active working tree.
- Never overwrite user changes.
- Base all candidates from a clean base branch.
- Keep candidate artifacts separate.
- Finalization cherry-picks, merges, or manually applies the winning candidate into a final branch.

## Agent Roles and Prompt Contracts
### Intake Agent
Prompt shape:

```text
You are the intake agent. Fetch and normalize the task source.
Produce intake.json with source facts only. Do not propose implementation yet.
Flag ambiguity, missing context, risks, and linked references.
```

### Product Owner Agent
```text
You are the Product Owner agent. Convert the task into requirements.
Write clear functional requirements, non-functional requirements, acceptance criteria,
assumptions, open questions, and approval recommendation.
Every requirement must have a stable ID.
```

### Spec Agent
```text
You are the Spec agent. Transform approved requirements into an implementation-ready spec.
Prefer existing project patterns. Include technical approach, affected areas, edge cases,
test plan, security considerations, and traceability links to requirement IDs.
```

### Decomposition Agent
```text
You are the task decomposition agent. Split the spec into ordered, parallelizable task groups.
Identify dependencies, conflicts, candidate strategy, verification requirements, and handoff notes.
Do not implement.
```

### Implementation Agent
```text
You are a local implementation agent working in your assigned git worktree.
Implement only your assigned task package. Preserve existing user changes.
Add or update tests. Keep a log mapping commits/files/tests to requirement IDs.
Stop and report blockers instead of guessing across major ambiguity.
```

### Verifier Agent
```text
You are the verifier. Evaluate the candidate against requirements, tests, edge cases,
security, maintainability, and project standards. Run configured checks locally.
Produce pass/fail findings with exact remediation instructions.
```

### PO Acceptance Agent
```text
You are the PO acceptance checker. Judge whether the implementation satisfies the
original user intent and acceptance criteria. Focus on behavior, not code style.
Mark each AC as pass, fail, partial, or unverified.
```

### Security Reviewer
```text
You are the security reviewer. Look for auth, authorization, data exposure, injection,
secret handling, dependency, logging, SSRF, XSS, CSRF, deserialization, and supply-chain risks.
Produce severity-ranked findings and required fixes.
```

### Finalization Agent
```text
You are the finalization agent. Select or assemble the best candidate, ensure verification passes,
prepare the final branch, write the PR body, create the PR, and record handoff artifacts.
```

### PR Manager
```text
You are the PR manager. Monitor CI, review comments, requested changes, conflicts,
and failing checks. Triage comments, implement clear fixes locally, rerun verification,
and update the PR until it is merge-ready or blocked.
```

## Requirement Traceability Model
Every requirement receives a stable ID.

Example:

```text
REQ-001: Users can import tasks from a GitHub issue.
AC-001: Given a GitHub issue URL, the system fetches title, body, comments, labels, and linked references.
```

Traceability records should map:

- Requirement ID
- Acceptance criteria IDs
- Spec section
- Task IDs
- Candidate implementation files
- Tests
- Verification checks
- PO acceptance result
- Security review result
- Final PR link

Example schema:

```json
{
  "requirements": [
    {
      "id": "REQ-001",
      "acceptance_criteria": ["AC-001", "AC-002"],
      "spec_sections": ["Spec: GitHub Issue Intake"],
      "tasks": ["TASK-001", "TASK-002"],
      "files": ["src/github/intake.ts"],
      "tests": ["tests/github-intake.test.ts"],
      "verification": {
        "lint": "pass",
        "typecheck": "pass",
        "unit": "pass",
        "integration": "pass",
        "browser": "not_applicable",
        "security": "pass",
        "po_acceptance": "pass"
      }
    }
  ]
}
```

## Verifier Design
The verifier runs layered checks.

Required verification categories:

- Lint
- Format check, if the repo has one
- Typecheck
- Unit tests
- Integration tests
- Browser/end-to-end tests where applicable
- Build
- Static security checks where available
- Dependency audit where appropriate
- Separate code review
- Security review
- PO acceptance criteria coverage
- Requirement traceability completeness

Verifier outputs:

- `verification-report.md`
- `requirement-coverage.json`
- `test-results.json`
- `edge-case-review.md`
- `code-review.md`
- `security-review.md`

A candidate cannot be selected unless required checks pass or an explicit waiver is recorded.

## PO Acceptance Criteria Checking
The PO acceptance checker should evaluate behavior against `requirements.md`, not against the implementer’s interpretation.

Each acceptance criterion is marked:

- `pass`
- `fail`
- `partial`
- `unverified`
- `not_applicable`

For every non-pass, include:

- Expected behavior
- Observed behavior
- Evidence
- Suggested correction
- Whether reimplementation is required

The PO checker should also identify “technically correct but product-wrong” outcomes, such as solving the wrong user flow, adding unnecessary scope, or changing semantics not requested by the issue.

## Tests and Edge-Case Strategy
The decomposition agent must define expected test coverage before implementation starts.

Coverage plan should include:

- Happy path
- Error path
- Permission/auth cases
- Empty/null/missing data
- Boundary values
- Concurrency or race conditions
- Idempotency
- Backward compatibility
- Migration/rollback behavior
- Accessibility for UI changes
- Browser coverage for user-facing flows
- Regression tests for the issue being fixed

Test commands are repo-configurable. The verifier should detect available package scripts but prefer explicit config.

## Security Review Strategy
Security review is mandatory for every PR, with depth based on risk.

Minimum checks:

- Secrets not committed
- No credential logging
- Input validation
- Output encoding
- Authn/authz boundaries
- Data access scope
- Injection risks
- XSS/CSRF for web apps
- SSRF for URL-fetching code
- Unsafe file operations
- Dependency changes
- Dangerous shell execution
- Token and GitHub permission handling
- Privacy-sensitive logs/artifacts

Security findings use severity:

- `critical`: cannot create or update PR except with fix
- `high`: must fix before finalization
- `medium`: fix or explicitly waive
- `low`: may be documented follow-up

## PR Creation and Finalization
The finalization agent creates a final local branch from the base branch, applies the selected candidate, reruns required verification, and opens a GitHub PR.

PR body should include:

- Summary
- Linked issue
- Requirement coverage summary
- Tests run
- Browser verification, if any
- Security review summary
- Known limitations or waivers
- Artifacts path
- Screenshots/video if relevant

PR creation command should use `gh pr create` locally.

No cloud execution should be introduced. GitHub CI may run because it is part of repository hosting, but implementation agents must not execute in the cloud.

## PR Monitoring Loop
After PR creation, a background manager monitors:

- CI status
- Review comments
- Requested changes
- Merge conflicts
- New issue comments
- Failed checks
- Stale approvals after changes

Loop behavior:

1. Poll PR status at configurable interval.
2. Summarize changes since last poll.
3. Classify comments as clear fix, question, disagreement, or blocker.
4. Apply clear fixes locally.
5. Rerun relevant verification.
6. Push updates to the PR branch.
7. Ask the user for decisions on ambiguous or product-sensitive comments.
8. Stop when merge-ready, merged, closed, or blocked.

## State, Logging, and Artifacts
Every run should have durable local state.

Required artifacts:

- Intake
- Requirements
- Spec
- Tasks
- Approval record
- Worktree manifest
- Candidate logs
- Test outputs
- Verification reports
- Security review
- PO acceptance report
- Final PR body
- PR monitoring log
- Decision log
- Waiver log

State machine:

```text
created
intake_complete
requirements_ready
spec_ready
tasks_ready
awaiting_approval
implementing
verifying
retrying
finalizing
pr_opened
monitoring_pr
merge_ready
blocked
done
```

Logs should be human-readable markdown plus machine-readable JSON for automation.

## Failure and Retry Policy
Failures are expected and should be structured.

Failure categories:

- Missing context
- Ambiguous requirement
- Implementation error
- Test failure
- Type/lint failure
- Security issue
- PO acceptance failure
- Merge conflict
- CI-only failure
- Reviewer-requested change
- Tooling/environment failure

Retry policy:

- Implementation candidates get a configurable retry budget.
- Verifier feedback must be specific and linked to failed requirements/checks.
- Repeated failure escalates to the user with a concise blocker report.
- Security-critical failures stop finalization until fixed.
- PO acceptance failures loop back to spec/decomposition if the implementation misunderstood the task.

Recommended defaults:

```yaml
retry:
  max_candidate_retries: 2
  max_verification_loops: 3
  max_pr_comment_fix_loops: 5
  stop_on_security_high: true
  stop_on_unresolved_po_failure: true
```

## Configuration Schema
Example `config.yaml`:

```yaml
workflow:
  local_only: true
  default_source: github
  default_depth: standard
  candidate_strategy: hybrid
  max_parallel_candidates: 3

approval:
  required_after_decomposition: true
  required_before_pr: false
  allow_autorun_for_low_risk: true
  max_autonomy_risk: medium

github:
  default_base_branch: main
  branch_prefix: agentic
  pr_draft_by_default: false
  link_issue: true
  monitor_after_open: true
  monitor_interval_seconds: 300

worktrees:
  root: ../.agentic-worktrees
  cleanup_on_success: false
  cleanup_on_failure: false

verification:
  required:
    - lint
    - typecheck
    - unit
    - integration
    - code_review
    - security_review
    - po_acceptance
    - requirement_traceability
  optional:
    - browser
    - dependency_audit
    - build
  commands:
    lint: npm run lint
    typecheck: npm run typecheck
    unit: npm test
    integration: npm run test:integration
    browser: npm run test:e2e
    build: npm run build

security:
  severity_blocking:
    - critical
    - high
  check_dependencies: true
  check_secrets: true

traceability:
  require_requirement_ids: true
  require_test_mapping: true
  require_po_acceptance: true

agents:
  po:
    framework: bmad
  spec:
    framework: agent-os
  decomposition:
    framework: agent-os
  implementation:
    count: auto
  verifier:
    require_independent_context: true
```

## Commands
Suggested local CLI surface:

```bash
agentic init
agentic intake github owner/repo#123
agentic shape --run <run-id>
agentic spec --run <run-id>
agentic decompose --run <run-id>
agentic approve --run <run-id>
agentic implement --run <run-id>
agentic verify --run <run-id>
agentic finalize --run <run-id>
agentic pr create --run <run-id>
agentic pr monitor --pr <url>
agentic status --run <run-id>
agentic artifacts --run <run-id>
```

Cursor prompt equivalents should also exist for users who prefer direct agent interaction:

```text
Run the GitHub issue intake workflow for owner/repo#123.
Run PO clarification and write requirements.
Decompose this approved spec into parallel local worktree tasks.
Implement approved tasks locally using parallel worktrees.
Verify all candidates and select the best one.
Finalize this run into a GitHub PR.
Monitor this PR until merge-ready.
```

## UX Flow
Default user experience:

1. User gives GitHub issue.
2. Cursor shows normalized issue summary.
3. PO asks only necessary clarifying questions.
4. Cursor writes requirements/spec/tasks.
5. User approves decomposition.
6. Cursor starts local parallel worktrees.
7. User receives progress summaries.
8. Verifier reports candidate ranking.
9. Cursor finalizes selected candidate.
10. PR is opened.
11. PR manager keeps working on CI/review feedback.
12. User is notified when merge-ready or blocked.

Autonomous mode:

- User gives issue and says “run fully autonomous.”
- System skips approval gates allowed by config.
- Ambiguity, high-risk security concerns, destructive migrations, or product-sensitive tradeoffs still stop for user input unless explicitly overridden.

## Rollout Plan
### Phase 1: Local Artifact and Spec Foundation
Implement repo-local artifact layout, config schema, GitHub issue intake, PO requirements, spec writing, and task decomposition.

### Phase 2: Cursor Skills and Rules
Create Cursor Skills for intake, PO, spec, decomposition, verification, finalization, and PR monitoring. Add rules for local-only execution, quality, security, and traceability.

### Phase 3: Worktree Orchestration
Add local worktree creation, branch naming, candidate manifests, candidate assignment prompts, and candidate logs.

### Phase 4: Verification Harness
Implement command runner for lint, typecheck, unit, integration, browser, build, security, code review, PO acceptance, and traceability.

### Phase 5: Candidate Selection and Finalization
Add candidate ranking, merge/cherry-pick strategy, final branch creation, final verification, and PR body generation.

### Phase 6: PR Monitoring
Add `gh`-based polling for CI, comments, review state, conflicts, and requested changes. Implement fix loops and blocker escalation.

### Phase 7: Customization and Source Expansion
Add adapters for other task sources while preserving GitHub as the first source. Add per-repo workflow profiles and deeper standards discovery.

## Risks and Mitigations
Risk: Parallel candidates create merge complexity.  
Mitigation: Use competitive mode for same-scope work and partitioned mode only when task boundaries are clean.

Risk: Agents optimize for tests but miss product intent.  
Mitigation: Separate PO acceptance from technical verification.

Risk: Too many gates reduce autonomy.  
Mitigation: Make all gates configurable with risk-based defaults.

Risk: Local machine resource exhaustion.  
Mitigation: Limit parallel candidates and serialize heavy test suites.

Risk: Security review becomes checklist-only.  
Mitigation: Require severity-ranked findings and block high-risk categories.

Risk: Specs become stale after retries.  
Mitigation: Failed PO acceptance can route back to spec/decomposition, not just implementation.

Risk: Hidden cloud execution slips in through tools.  
Mitigation: Rules and hooks block cloud agent commands and require local-only execution.

## Pros and Cons
Pros:

- Strong local control and privacy
- Excellent customization
- Clear traceability from issue to PR
- Higher quality through independent verification
- Works with Cursor as the main harness
- Can scale from lightweight fixes to complex features
- BMAD and Agent OS complement each other cleanly

Cons:

- More local setup than a simple single-agent workflow
- Parallel worktrees require careful git hygiene
- Verification can be slower on large repos
- Some autonomy still depends on quality of prompts, specs, and repo tests
- PR monitoring can become noisy without good comment classification

## Exact Implementation Phases
1. Define `.agentic/config.yaml` schema and artifact structure.
2. Add GitHub issue intake using local `gh`.
3. Add Agent OS-style `standards/product/specs` artifact generation.
4. Add BMAD-style PO clarification and readiness prompt.
5. Add formal spec generation.
6. Add task decomposition with approval gate.
7. Add worktree manager.
8. Add implementation-agent prompt generator.
9. Add candidate execution workflow inside local Cursor/worktrees.
10. Add verification command runner.
11. Add requirement traceability generator.
12. Add independent code review agent.
13. Add security review agent.
14. Add PO acceptance checker.
15. Add retry loop with targeted verifier feedback.
16. Add candidate ranking and selection.
17. Add final branch assembly.
18. Add final verification.
19. Add PR body generation and `gh pr create`.
20. Add PR monitor for CI and comments.
21. Add reviewer-comment fix loop.
22. Add cleanup/archive commands.
23. Add Cursor Skills.
24. Add Cursor Rules.
25. Add Cursor Hooks.
26. Add documentation and example workflows.
27. Add support for future task-source adapters.

## Final Recommendation
Adopt Agent OS as the durable spec/context file model and BMAD as the agent role/process model, then bind both into Cursor through Skills, Rules, Hooks, and local orchestration scripts. Keep GitHub issue to PR as the first complete path, with every artifact and decision stored locally. This gives the user the desired aggressive autonomy while preserving quality through decomposition approval, independent verification, security review, PO acceptance, and PR monitoring.
