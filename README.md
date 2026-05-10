# agentic-my-app

TypeScript CLI for a **local-only** agentic workflow on top of [`@cursor/sdk`](https://cursor.com/docs/api/sdk/typescript). Here, `localOnly` means Cursor agents must run with the SDK local runtime against the local workspace/worktree via `local: { cwd, settingSources }`; Cursor **Cloud** runtime is forbidden (see `src/sdk/createLocalAgent.ts`).

- Architecture: [`docs/plan.md`](docs/plan.md)
- Status: [`PROGRESS.md`](PROGRESS.md)

**Migration from older names:** The default config file is now `agentic-my-app.config.yaml`; the npm package/bin is `agentic-my-app`. Environment variables use the `AGENTIC_MY_APP_*` prefix. For a transition period, **`ORCHESTRATOR_CONFIG`**, **`ORCHESTRATOR_STREAM`**, and other former **`ORCHESTRATOR_*`** variables listed in `src/util/agenticEnv.ts` are still read as fallbacks.

## Requirements

- Node.js 20+
- **Ripgrep (`rg`)** on your PATH, or set **`CURSOR_RIPGREP_PATH`** to the absolute path of the binary (required by `@cursor/sdk` local ignore handling)
- [`gh`](https://cli.github.com/) for GitHub issue intake and PR operations
- `CURSOR_API_KEY` (or the env name in `runtime.cursor.apiKeyEnv`) for any command that runs Cursor agents
- Jira intake via REST needs `JIRA_SITE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN`; without `JIRA_API_TOKEN`, Jira intake requires a configured Atlassian MCP plugin and `CURSOR_API_KEY`
- If Node prints **`MaxListenersExceededWarning`** for `AbortSignal`, raise the cap via **`AGENTIC_MY_APP_ABORT_LISTENER_BUDGET`** (legacy **`ORCHESTRATOR_ABORT_LISTENER_BUDGET`**; ≥ 11; default in `src/util/elevateAbortListenerBudget.ts` is **512** — long **`monitor-pr`** runs share one signal across many SDK turns)

## Setup

```bash
cd /path/to/this/repo
npm install
npm run build
```

Development (TypeScript directly):

```bash
npm run dev -- --help
```

### Global CLI (any repo)

From this package directory, build and register the global `agentic-my-app` command:

```bash
npm run global:link
```

Ensure your shell’s PATH includes npm’s global bin (e.g. `npm prefix -g` + `/bin`). Then run from another repo:

```bash
cd /path/to/other-repo
agentic-my-app init
agentic-my-app --help
agentic-my-app status <runId> --cwd /path/to/other-repo
```

Remove the global links:

```bash
npm unlink --global agentic-my-app
npm unlink agentic-my-app # if you npm link'ed into another project
```

### npm Publishing

GitHub Actions runs semantic-release from `.github/workflows/npm-publish.yml` on every push to `main` and when the workflow is run manually. semantic-release analyzes Conventional Commits, creates the GitHub release/tag, and publishes the package to npm.

Repository setup:

- Add an npm automation token as the GitHub Actions secret `NPM_TOKEN`.
- Use Conventional Commits (`feat:`, `fix:`, breaking changes) on changes merged to `main`.
- The first semantic-release publication starts at `1.0.0` when there is no prior release tag.
- The workflow runs `npm ci`, `npm run build`, `npm pack --dry-run`, then `npm run release` with npm provenance enabled.

## Configuration

- Default: `./agentic-my-app.config.yaml`
- Override: `AGENTIC_MY_APP_CONFIG=/path/agentic-my-app.config.yaml` (legacy: `ORCHESTRATOR_CONFIG`)

Generate defaults:

```bash
node ./dist/cli.js init
```

Important sections:

- **`jira`**: optional Jira intake settings. If `JIRA_API_TOKEN` (or `jira.apiTokenEnv`) is present with `JIRA_SITE_URL` / `JIRA_EMAIL` (or YAML `jira.siteUrl` / `jira.email`), `agentic-my-app` fetches tickets via Jira REST. If the token is absent, Jira intake falls back to an Atlassian MCP flow through Cursor plugins, so the local Cursor/Atlassian MCP setup must be available and `CURSOR_API_KEY` must be set.
- **`workflow`**: approval gates, autonomy (`autoApproveSpec`, `autoApproveDecomposition`, `allowAutoPushPrFixes`), parallelism (`implementationCandidates`, `maxConcurrentAgents`), optional **`stepPrompts`** (map of extra instructions prepended to each phase’s default prompt; keys match model roles in `runtime.cursor.models` — `po`, `decomposer`, `testWriter`, `implementer`, `verifier`, `codeReviewer`, `cleanup`, `securityReviewer`, `poAcceptance`, `finalizer` — plus **`prFix`** for the PR-monitor fix loop). Each value is either a **string** (inline instructions) or **`{ file: "./relative-or-abs-path.md" }`**; paths are resolved **relative to the directory containing the loaded `agentic-my-app.config.yaml`** (or relative to the directory of the file set via `AGENTIC_MY_APP_CONFIG` / legacy `ORCHESTRATOR_CONFIG`). Example:

  ```yaml
  workflow:
    stepPrompts:
      implementer: "Prefer minimal diffs."
      verifier:
        file: "./prompts/extra-verifier-notes.md"
    skipSteps:
      - securityReviewer
      - poAcceptance
      - prMonitor
  ```

  Use **`workflow.skipSteps`** for agent-driven phases to omit (validated at config load — see **`src/config/workflowSkipSteps.ts`**). Omitting **`verifier`** still runs **`verification.commands`**; the LLM diff review is skipped and a synthetic verdict is emitted (see verifier notes). Skipping **`po`** / **`decomposer`** fails fast unless **`requirements.md`** / **`decomposition.json`** already exist. Skipping **`implementer`** or **`testWriter`** leaves little or no code change unless you intervene manually in the worktree. **`prMonitor`** skips CLI-driven **`full`** / **`workflow --follow-pr`** monitoring and architecture-prototype monitoring; **`monitor-pr`** ignores skip (explicit invocation). **`prFix`** skips the monitor’s automated fix-push loop while polling continues.

  and optional **`consultHuman`** (terminal prompts during PO/decomposition: model `<AGENTIC_MY_APP_ASK_HUMAN>` blocks and **best‑effort** prompts before tools; legacy `<ORCHESTRATOR_ASK_HUMAN>` is still recognized). With **`consultHuman.pauseBeforeTools: true`** and **`confirmAllTools: false`** (default), only **destructive / high‑risk tools** prompt (e.g. deletes, force push, `rm -rf`, `git reset --hard`; logic in `src/util/toolConsultRisk.ts`). Set **`confirmAllTools: true`** to confirm every tool. Enable consult with `workflow.consultHuman.enabled: true`, **`AGENTIC_MY_APP_CONSULT_HUMAN=1`** (legacy **`ORCHESTRATOR_CONSULT_HUMAN`**), or **`agentic-my-app plan --consult`** / **`agentic-my-app full --consult`** (`--no-consult` turns it off). Candidate worktrees run a **test writer** pass before the implementation agent.
- **`verification`**: `commands` map and `require` flags for mechanical checks (e.g. `build: true`), plus **`maxImplementRetriesAfterVerify`** (default **3**) — after a failing verify round, **`Agent.resume`** runs the implementer on the same worktree with verifier output, manual QA verifier output, and failing command logs until gates pass or the cap is reached. Code/security/PO review output feeds the **cleanup** agent, then the selected candidate runs through the verifier/retry loop again. The verifier prompt must begin with **`AGENTIC_MY_APP_VERDICT: PASS`** or **`AGENTIC_MY_APP_VERDICT: FAIL`** (legacy **`ORCHESTRATOR_VERDICT`** still accepted; see `prompts/verifier.md`); the parallel manual QA verifier emits **`AGENTIC_MY_APP_MANUAL_QA_VERDICT: PASS`** or **`AGENTIC_MY_APP_MANUAL_QA_VERDICT: FAIL`**.
- **`repo`**: `worktreeRoot` (relative to cwd) for implementation worktrees.
- **`monitoring`**: `pollIntervalSeconds`, `maxFixLoops`, `maxPollCycles`. **`monitor-pr`** loads **every page** of: conversation comments (`issues/…/comments`), inline review threads including replies (`pulls/…/comments`), and submitted review summaries with bodies (`pulls/…/reviews`); runs fix agent, push, and replies on GitHub when there is actionable feedback or CI failure handling applies. Comments from **any author** (PR author, reviewers, you) are eligible; known **bots** are skipped. **`AGENTIC_MY_APP_MONITOR_DEBUG=1`** (legacy **`ORCHESTRATOR_MONITOR_DEBUG`**) emits `[monitor-debug …]` lines on stderr with fetch/pagination and tick details. **`monitor/addressed-feedback.json`** tracks `issueCommentIds`, `reviewCommentIds`, and **`pullReviewIds`** (submitted review summaries). **Tool replies** are prefixed **`[Agentic Platform]`** on GitHub; incoming comments that **start with** that marker (after leading whitespace) are **not** reacted to (avoids ping-pong with our own posts).

## Commands

| Command | Purpose |
| --- | --- |
| `init` | Write `agentic-my-app.config.yaml` if missing (`--force` overwrites) |
| `smoke` | Local `Agent.create` → `send` → `wait` (skips if no API key) |
| `full` / `auto` | Single continuous flow: `--issue` / `--jira` / `--task` / `[runId]` → PO requirements/decomposition → test writer → implementer → mechanical checks + verifier → review/cleanup/re-verify → finalizer/PR → **monitor** (CI + PR feedback) → **`gh pr merge`** when review is **APPROVED**, checks have no **FAILURE**, no PR feedback is queued in the current poll, and branch is not **CONFLICTING** (`--merge merge\|squash\|rebase`). `auto` skips spec/decomposition approval prompts, streams visible model output by default, still routes planning questions to the terminal, and asks before destructive/high-risk tool calls unless `--no-consult` is used. |
| `prototype` | Single-command prototype of the sketch architecture: `--issue` / `--jira` / `--task` / `[runId]` → Product Owner requirements → test writer → implementation agent → verifier/repair loop → cleanup/evaluation → PR creation → optional PR monitor/merge. |
| `issue [spec]` | Parse issue ref; `gh issue view` (+ optional linked PRs); write `task-input.json` |
| `jira <key>` | Parse Jira key like `PROJECT-123`; fetch via Jira REST when API token env is present, otherwise use Atlassian MCP through Cursor plugins; write `task-input.json` |
| `task <file.md>` | Create a run from a markdown task file |
| `plan <runId>` | PO + decomposition agents → `requirements.md`, `decomposition.json` (**`--consult`** / **`--no-consult`** override YAML for this invocation) |
| `workflow <runId>` (alias `run`) | Advance from current `state.json` phase through PR (optional `--follow-pr`) |
| `approve <runId> spec\|decomposition` | Record gate approval |
| `implement <runId>` | Git worktrees + implementation agents |
| `verify <runId>` | Mechanical checks + verifier/manual QA agents + sequential review passes |
| `finalize <runId>` | Finalizer, `git push`, `gh pr create` |
| `monitor-pr <url> --run <runId>` | Poll until PR **MERGED**/ **CLOSED**, **merge when APPROVED** by default (`--no-merge` to only watch). Replies are prefixed `[Agentic Platform]`; comments that **already** start with that prefix are skipped (see `prFeedbackGithub`). Fix agent + push + reply; writes JSON outcome and **exits** (code **2** if API key missing) |
| `resume <runId>` | Same as `workflow` (explicit name for recovery) |
| `cancel <runId>` | Set `cancelRequested` on run state |
| `status <runId>` | Print `state.json` |
| `sdk-resume` | `Agent.resume` follow-up with a persisted `agentId` (audit / advanced) |
| `verify-cmd <runId>` | Run configured verification commands in cwd (debug) |

Human-gated default: edit/approve after `plan`, then `agentic-my-app approve …` and `agentic-my-app workflow …`. For a continuous autonomous run, use **`agentic-my-app auto --issue OWNER/REPO#123`** or **`agentic-my-app auto --task task.md`**; it keeps terminal consultation enabled for planning questions and destructive/high-risk tool calls.

Prototype architecture run:

```bash
agentic-my-app prototype --issue OWNER/REPO#123
# or
agentic-my-app prototype --task task.md
```

The prototype is intentionally single-candidate and diagram-shaped: it writes requirements, has a test writer produce tests/expectations before implementation, loops verifier failures back to the same implementer, runs cleanup and evaluation agents, opens a PR, then monitors comments/CI when `monitoring.enabled` is true. Use `--no-monitor` to stop after PR creation and `--no-stream` to suppress live agent output.

Streaming agent output: `full` / `auto` stream visible model text by default; pass `--no-stream` to disable, or set `AGENTIC_MY_APP_STREAM=1` (legacy `ORCHESTRATOR_STREAM`) for lower-level commands.

## Artifacts

Under `.agentic-my-app/runs/<runId>/` (or `artifacts.root`):

- `state.json`, `task-input.json`, `requirements.md`, `decomposition.json`, `approvals.json`
- `transcripts/`, `agents/`, `candidates/`, `verification/`, `commands/`, `monitor/` (see `monitor/addressed-feedback.json` for PR comment ids already handled), `logs/`

## Implemented Workflow

The automatic path follows the specified diagram:

1. Product Owner / decomposition agents define requirements, scope, and work packages.
2. A test writer agent runs in each candidate worktree before implementation, adding focused tests or `test-expectations.md` when the framework is unclear.
3. The implementation agent receives the requirements, task brief, verification commands, and test-writer output.
4. Mechanical checks plus parallel verifier and manual QA verifier agents evaluate the candidate; failures resume the implementer with feedback until the retry cap is reached.
5. Code, security, and PO acceptance reviews produce recommendations for the winning candidate.
6. A cleanup agent applies verifier/review recommendations, including tests first when recommendations require them, then required checks run again.
7. The finalizer prepares the branch and the CLI creates the PR.
8. The PR monitor always fetches PR feedback, ignores only addressed IDs, bots, empty bodies, and `[Agentic Platform]`-prefixed comments, then fixes/pushes/replies and exits when the PR is merged or closed.

## Policy

- All Cursor agents must go through `createLocalAgent` (or equivalent guard). Never pass `cloud` options.
- Secrets: transcripts redact common token patterns; structured logs run `redactSecrets` on `data` payloads before write.
