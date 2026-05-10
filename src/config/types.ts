import type { WorkflowSkipStepId } from "./workflowSkipSteps.js";

export type AgenticMyAppConfig = {
  runtime: {
    cursor: {
      apiKeyEnv: string;
      localOnly: boolean;
      settingSources: Array<
        "project" | "user" | "team" | "mdm" | "plugins" | "all"
      >;
      models: {
        po: string;
        decomposer: string;
        testWriter: string;
        implementer: string;
        verifier: string;
        codeReviewer: string;
        cleanup: string;
        securityReviewer: string;
        poAcceptance: string;
        finalizer: string;
      };
    };
  };
  artifacts: {
    root: string;
    redactSecrets: boolean;
    keepTranscripts: boolean;
  };
  repo: {
    defaultBaseBranch: string;
    requireCleanTree: boolean;
    worktreeRoot: string;
    preserveFailedWorktrees: boolean;
  };
  github: {
    defaultRepo: string;
    prDraft: boolean;
  };
  jira: {
    /** Atlassian site URL, e.g. https://example.atlassian.net. Can be overridden by env. */
    siteUrl: string;
    /** Atlassian account email for API token auth. Can be overridden by env. */
    email: string;
    /** Environment variable that holds a Jira/Atlassian API token. */
    apiTokenEnv: string;
    /** Environment variable that can override jira.siteUrl. */
    siteUrlEnv: string;
    /** Environment variable that can override jira.email. */
    emailEnv: string;
  };
  workflow: {
    approval: {
      requireSpecApproval: boolean;
      requireDecompositionApproval: boolean;
    };
    autonomy: {
      autoApproveSpec: boolean;
      autoApproveDecomposition: boolean;
      allowAutoPushPrFixes: boolean;
    };
    parallelism: {
      implementationCandidates: number;
      maxConcurrentAgents: number;
    };
    /**
     * Pause in the terminal during PO / decomposition for model questions and (best-effort) before tools.
     * Enable with `consultHuman.enabled`, or `AGENTIC_MY_APP_CONSULT_HUMAN=1` (legacy `ORCHESTRATOR_CONSULT_HUMAN`), or `plan --consult` / `full --consult`.
     */
    consultHuman?: {
      enabled: boolean;
      askHumanMarker?: boolean;
      pauseBeforeTools?: boolean;
      /**
       * With `pauseBeforeTools`, prompt for every tool. Default false = only deletes,
       * force-push, destructive shell patterns, etc. (`src/util/toolConsultRisk.ts`).
       */
      confirmAllTools?: boolean;
      maxConsultRounds?: number;
    };
    /**
     * Optional extra instructions prepended to the built-in prompt for each workflow phase.
     * Keys align with `runtime.cursor.models` (`po`, `implementer`, …) plus `prFix` for PR monitor fixes.
     */
    stepPrompts?: Partial<
      Record<WorkflowStepPromptKey, WorkflowStepPromptValue>
    >;
    /**
     * Agent-driven workflow units to skip (no agent spawn for that unit).
     * See `src/config/workflowSkipSteps.ts` for valid ids.
     */
    skipSteps?: WorkflowSkipStepId[];
  };
  verification: {
    commands: Record<string, string>;
    require: Record<string, boolean>;
    /**
     * After a failed verification (checks or verifier FAIL), dispatch this many extra
     * implementer rounds on the same worktree (`Agent.resume` when possible) before giving up.
     */
    maxImplementRetriesAfterVerify?: number;
  };
  monitoring: {
    enabled: boolean;
    pollIntervalSeconds: number;
    maxFixLoops: number;
    maxPollCycles: number;
  };
};

/** Matches `runtime.cursor.models` roles plus `prFix` (monitor `fixPr.md` pass). */
export type WorkflowStepPromptKey =
  | keyof AgenticMyAppConfig["runtime"]["cursor"]["models"]
  | "prFix";

/** Inline text or a path resolved relative to the directory containing `agentic-my-app.config.yaml`. */
export type WorkflowStepPromptFileRef = { file: string };
export type WorkflowStepPromptValue = string | WorkflowStepPromptFileRef;
