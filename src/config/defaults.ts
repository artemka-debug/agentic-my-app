import type { AgenticMyAppConfig } from "./types.js";
import { WORKFLOW_SKIP_STEP_IDS } from "./workflowSkipSteps.js";

export const DEFAULT_CONFIG: AgenticMyAppConfig = {
  runtime: {
    cursor: {
      apiKeyEnv: "CURSOR_API_KEY",
      localOnly: true,
      settingSources: [],
      models: {
        po: "composer-2",
        decomposer: "composer-2",
        testWriter: "composer-2",
        implementer: "composer-2",
        verifier: "composer-2",
        codeReviewer: "composer-2",
        cleanup: "composer-2",
        securityReviewer: "composer-2",
        poAcceptance: "composer-2",
        finalizer: "composer-2",
      },
    },
  },
  artifacts: {
    root: ".agentic-my-app/runs",
    redactSecrets: true,
    keepTranscripts: true,
  },
  repo: {
    defaultBaseBranch: "main",
    requireCleanTree: false,
    worktreeRoot: "../worktrees",
    preserveFailedWorktrees: true,
  },
  github: {
    defaultRepo: "",
    prDraft: false,
  },
  jira: {
    siteUrl: "",
    email: "",
    apiTokenEnv: "JIRA_API_TOKEN",
    siteUrlEnv: "JIRA_SITE_URL",
    emailEnv: "JIRA_EMAIL",
  },
  workflow: {
    approval: {
      requireSpecApproval: true,
      requireDecompositionApproval: true,
    },
    autonomy: {
      autoApproveSpec: false,
      autoApproveDecomposition: false,
      allowAutoPushPrFixes: true,
    },
    parallelism: {
      implementationCandidates: 1,
      maxConcurrentAgents: 1,
    },
    consultHuman: {
      enabled: false,
      askHumanMarker: true,
      pauseBeforeTools: true,
      confirmAllTools: false,
      maxConsultRounds: 12,
    },
    /** Same keys as in init template; empty values mean no extra instructions. */
    stepPrompts: {},
    skipSteps: [],
  },
  verification: {
    commands: {
      lint: "npm run lint",
      typecheck: "npm run typecheck",
      unit: "npm test",
      build: "npm run build",
    },
    require: {
      lint: false,
      typecheck: false,
      unit: false,
      integration: false,
      browser: false,
      build: true,
    },
    maxImplementRetriesAfterVerify: 3,
  },
  monitoring: {
    enabled: true,
    pollIntervalSeconds: 60,
    maxFixLoops: 5,
    maxPollCycles: 360,
  },
};

/** Template for `agentic-my-app init`; values match {@link DEFAULT_CONFIG} plus inline documentation. */
export const DEFAULT_CONFIG_YAML = `# agentic-my-app — local Cursor SDK workflow
#
# Default path: ./agentic-my-app.config.yaml
# Override: AGENTIC_MY_APP_CONFIG=/path/to/file.yaml (legacy: ORCHESTRATOR_CONFIG)
#
# Booleans: true | false. Numbers: non-negative integers unless noted.

runtime:
  cursor:
    # Environment variable name (string) that holds the Cursor API key.
    apiKeyEnv: CURSOR_API_KEY

    # Only true is valid for this package (local SDK agents). loadConfig rejects false.
    localOnly: true

    # Cursor Agent settingSources: zero or more of:
    #   project | user | team | mdm | plugins | all
    # Empty [] = do not inject extra setting sources.
    settingSources: []

    # Per-role Cursor model ids (strings). Use ids your account supports (e.g. composer-2, gpt-5.4-medium).
    models:
      po: composer-2
      decomposer: composer-2
      testWriter: composer-2
      implementer: composer-2
      verifier: composer-2
      codeReviewer: composer-2
      cleanup: composer-2
      securityReviewer: composer-2
      poAcceptance: composer-2
      finalizer: composer-2

artifacts:
  # Directory (relative to cwd) where run ids and logs are stored.
  root: .agentic-my-app/runs

  # Whether to redact obvious secrets in persisted artifacts.
  redactSecrets: true

  # Keep agent transcript files under the run directory.
  keepTranscripts: true

repo:
  # Default base branch name for worktrees / PRs when not taken from the issue.
  defaultBaseBranch: main

  # If true, refuse to start the pipeline unless the main repo working tree is clean.
  requireCleanTree: false

  # Path (relative to cwd) where parallel git worktrees are created.
  worktreeRoot: ../worktrees

  # If true, keep worktrees that failed verification; if false, they may be removed on retry paths.
  preserveFailedWorktrees: true

github:
  # Default owner/repo (e.g. myorg/myrepo) for bare issue numbers and task hints. May be empty if you always pass full refs.
  defaultRepo: ""

  # If true, gh pr create uses --draft.
  prDraft: false

jira:
  # Atlassian site URL for REST API intake. Can also be set with JIRA_SITE_URL.
  siteUrl: ""

  # Atlassian account email for REST API token auth. Can also be set with JIRA_EMAIL.
  email: ""

  # Env var that holds a Jira/Atlassian API token. If missing, Jira intake falls back to Atlassian MCP via Cursor plugins.
  apiTokenEnv: JIRA_API_TOKEN

  # Env vars that can override siteUrl/email without editing config.
  siteUrlEnv: JIRA_SITE_URL
  emailEnv: JIRA_EMAIL

workflow:
  approval:
    # If true (and autonomy does not auto-approve), PO spec needs human approval before continuing.
    requireSpecApproval: true

    # If true (and autonomy does not auto-approve), decomposition needs human approval before implement.
    requireDecompositionApproval: true

  autonomy:
    # Skip spec approval gate when true (use with care).
    autoApproveSpec: false

    # Skip decomposition approval gate when true (use with care).
    autoApproveDecomposition: false

    # Allow the PR monitor / fix loop to push commits for CI or review feedback.
    allowAutoPushPrFixes: true

  parallelism:
    # How many competing implementation worktrees/candidates to run (integer >= 1).
    implementationCandidates: 1

    # Cap on concurrent agent runs across candidates/steps (integer >= 1).
    maxConcurrentAgents: 1

  consultHuman:
    # Terminal Human-in-the-loop for planning questions and risky tools. Can also set AGENTIC_MY_APP_CONSULT_HUMAN=1 (legacy ORCHESTRATOR_CONSULT_HUMAN) or use plan/full --consult.
    enabled: false

    # React to model "ask human" style markers in output.
    askHumanMarker: true

    # Best-effort pause before tools; consult util/toolConsultRisk for what counts as risky.
    pauseBeforeTools: true

    # If true with pauseBeforeTools, prompt before every tool; if false, only high-risk tools.
    confirmAllTools: false

    # Maximum consultation rounds per step (integer >= 1).
    maxConsultRounds: 12

  # --- Custom prompts: workflow.stepPrompts ---
  # Text here is prepended to the built-in template for that step (see "## Step-specific instructions"
  # in the agent prompt). It does not replace packaged prompts under prompts/ in the package.
  #
  # Value shapes (per key):
  #   - Inline:  myKey: "Short instructions for this step."
  #   - From file:  myKey: { file: "./relative/path/from/this-config-dir.md" }
  #     Paths resolve relative to the directory containing this YAML (or AGENTIC_MY_APP_CONFIG file).
  #
  # Keys below match runtime.cursor.models roles plus prFix. The verify→implement retry pass uses
  # implementVerifyRetry.md but shares the implementer key (same extra instructions as implement).
  stepPrompts:
    po: "" # base: prompts/po.md
    decomposer: "" # base: prompts/decompose.md
    testWriter: "" # base: prompts/testWriter.md
    implementer: "" # base: prompts/implement.md (+ implementVerifyRetry.md on verify retry)
    verifier: "" # base: prompts/verifier.md
    codeReviewer: "" # base: prompts/codeReview.md
    cleanup: "" # base: prompts/cleanup.md
    securityReviewer: "" # base: prompts/securityReview.md
    poAcceptance: "" # base: prompts/poAcceptance.md
    finalizer: "" # base: prompts/finalize.md
    prFix: "" # base: prompts/fixPr.md (PR monitor automated fix loop; model: finalizer)

  # Agent-driven units to skip. Each item must be one of:
  #   ${WORKFLOW_SKIP_STEP_IDS.join(", ")}
  skipSteps: []

verification:
  # Named shell commands run in the target repo. Keys are arbitrary; required checks reference these names.
  commands:
    lint: npm run lint
    typecheck: npm run typecheck
    unit: npm test
    build: npm run build
    # Optional examples (uncomment and match your package.json):
    # integration: npm run test:integration
    # browser: npm run test:e2e

  # If true for a name, that command must exit 0 during verification. Names must match keys in verification.commands.
  require:
    lint: false
    typecheck: false
    unit: false
    integration: false
    browser: false
    build: true

  # After verify failure, how many extra implementer rounds (resume/same worktree) before giving up.
  maxImplementRetriesAfterVerify: 3

monitoring:
  # Run PR polling / fix loops after PR creation when true (also subject to CLI flags).
  enabled: true

  # Seconds between PR / CI polls during monitor (positive number).
  pollIntervalSeconds: 60

  # Max agent fix loops per monitor session for a single failure context.
  maxFixLoops: 5

  # Hard cap on poll iterations before stopping the monitor (positive integer).
  maxPollCycles: 360
`;
