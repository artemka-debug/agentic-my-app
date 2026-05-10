import readlinePromises from "node:readline/promises";
import type { LoadedConfig } from "../config/loadConfig.js";
import {
  logWorkflowStepSkipped,
  workflowSkips,
} from "../config/workflowSkipSteps.js";
import type {
  MonitorMergeStrategy,
  MonitorPullRequestExitReason,
} from "../monitor/prMonitor.js";
import { monitorPullRequest } from "../monitor/prMonitor.js";
import {
  readState,
  readTaskInput,
  runPaths,
  type WorkflowPhase,
} from "../runs/runWorkspace.js";
import { execGit } from "../util/git.js";
import {
  approveDecomposition,
  approveSpec,
  runPoAndDecomposition,
  type PlanningHumanConsultSession,
} from "./planning.js";
import { runImplementCandidates } from "./implementCandidates.js";
import { runVerifyAndReviews } from "./verifyAndReview.js";
import { runFinalizeAndCreatePr } from "./finalizePr.js";

type Paths = ReturnType<typeof runPaths>;
type RL = readlinePromises.Interface;

/** Optional context for approval prompts (e.g. Telegram attaches artifacts). */
export type SessionConfirmMeta = {
  attachPaths?: string[];
};

/** Terminal or remote UI for progress logs and y/N-style approval gates. */
export type InteractiveFullSessionUi = {
  log: (message: string) => void;
  confirm: (prompt: string, meta?: SessionConfirmMeta) => Promise<boolean>;
};

export function workflowStepLog(message: string): void {
  process.stdout.write(`[agentic-my-app ${new Date().toISOString()}] ${message}\n`);
}

function isPlanningPhase(phase: WorkflowPhase): boolean {
  return (
    phase === "NEW" ||
    phase === "INTAKING_TASK" ||
    phase === "PO_DRAFTING" ||
    phase === "AWAITING_SPEC_APPROVAL" ||
    phase === "DECOMPOSING" ||
    phase === "AWAITING_DECOMPOSITION_APPROVAL"
  );
}

async function confirmRl(rl: RL, prompt: string): Promise<boolean> {
  rl.resume();
  const ans = (await rl.question(`${prompt} [y/N] `)).trim().toLowerCase();
  return ans === "y" || ans === "yes";
}

function pauseReadlineForBackgroundWork(rl: RL): void {
  try {
    rl.setPrompt("");
    rl.pause();
  } catch {
    /* readline may already be closed during shutdown */
  }
}

async function runInteractivePlanning(args: {
  loaded: LoadedConfig;
  paths: Paths;
  task: ReturnType<typeof readTaskInput>;
  autonomous: boolean;
  rl: RL;
  log: (message: string) => void;
  confirm: (prompt: string, meta?: SessionConfirmMeta) => Promise<boolean>;
  humanConsultSession?: PlanningHumanConsultSession;
  onAgentStreamChunk?: (text: string) => void;
}): Promise<void> {
  const {
    loaded,
    paths,
    task,
    autonomous,
    rl,
    log,
    confirm,
    humanConsultSession,
    onAgentStreamChunk,
  } = args;

  while (true) {
    log("Planning: drafting requirements and/or decomposition (agents)...");
    await runPoAndDecomposition({
      loaded,
      paths,
      task,
      autonomous,
      sharedReadline: rl,
      humanConsultSession,
      onAgentStreamChunk,
    });

    const state = readState(paths);
    if (state.phase === "CANCELLED") {
      throw new Error("Run was cancelled.");
    }

    if (state.phase === "AWAITING_SPEC_APPROVAL") {
      log(`Pending approval: specification — ${paths.requirements}`);
      if (!autonomous) {
        const ok = await confirm("Approve the requirements/spec and continue?", {
          attachPaths: [paths.requirements],
        });
        if (!ok) throw new Error("Spec approval declined.");
      }
      approveSpec(paths);
      log("Spec approval recorded.");
      continue;
    }

    if (state.phase === "AWAITING_DECOMPOSITION_APPROVAL") {
      log(`Pending approval: decomposition — ${paths.decomposition}`);
      if (!autonomous) {
        const ok = await confirm("Approve the decomposition/plan and continue?", {
          attachPaths: [paths.decomposition],
        });
        if (!ok) throw new Error("Decomposition approval declined.");
      }
      approveDecomposition(paths);
      log("Decomposition approval recorded.");
      continue;
    }

    if (state.phase === "PREPARING_WORKTREES") {
      log("Planning finished.");
      return;
    }

    throw new Error(
      `Planning stopped in unexpected phase: ${state.phase}${
        state.lastError ? ` (${state.lastError})` : ""
      }`,
    );
  }
}

function assertNotCancelledOrBlocked(paths: Paths, label: string): void {
  const state = readState(paths);
  if (state.phase === "CANCELLED") throw new Error("Run was cancelled.");
  if (state.phase === "BLOCKED_NEEDS_USER") {
    throw new Error(
      state.lastError ??
        `${label}: workflow is blocked and needs manual intervention.`,
    );
  }
}

/** End-to-end run with terminal prompts at approval gates + monitor until merge when approved. */
export async function runInteractiveFull(args: {
  loaded: LoadedConfig;
  paths: Paths;
  autonomous: boolean;
  rl: RL;
  mergeStrategy: MonitorMergeStrategy;
  /** Partial overrides for non-terminal UIs (e.g. Telegram). */
  sessionUi?: Partial<InteractiveFullSessionUi>;
  /** Non-TTY human consult for PO/decompose agents; bypasses TTY checks in planning. */
  humanConsultSession?: PlanningHumanConsultSession;
  /** Stream PO/decompose assistant text (e.g. Telegram) without relying on stdout. */
  onAgentStreamChunk?: (text: string) => void;
}): Promise<MonitorPullRequestExitReason> {
  const {
    loaded,
    paths,
    autonomous,
    rl,
    mergeStrategy,
    humanConsultSession,
    onAgentStreamChunk,
  } = args;
  const log = args.sessionUi?.log ?? workflowStepLog;
  const confirm =
    args.sessionUi?.confirm ??
    ((prompt: string, _meta?: SessionConfirmMeta) => confirmRl(rl, prompt));
  const task = readTaskInput(paths);

  let state = readState(paths);

  const monitorOnly =
    Boolean(state.prUrl) &&
    (state.phase === "MONITORING_PR" || state.phase === "COMPLETED");

  if (monitorOnly) {
    pauseReadlineForBackgroundWork(rl);
    log(
      `Resuming monitor + merge for existing PR — ${state.prUrl} (phase=${state.phase})`,
    );
    if (workflowSkips("prMonitor", loaded.config.workflow)) {
      logWorkflowStepSkipped("prMonitor");
      log("Skipping PR monitor (workflow.skipSteps).");
      return "skipped_pr_monitor_config";
    }
    const outcome = await monitorPullRequest({
      loaded,
      paths,
      prUrl: state.prUrl!,
      mergeWhenApproved: true,
      mergeStrategy,
      onLog: log,
      consult: humanConsultSession?.hooks,
      onAgentStreamChunk,
    });
    log("Monitor finished.");
    return outcome;
  }

  if (isPlanningPhase(state.phase)) {
    await runInteractivePlanning({
      loaded,
      paths,
      task,
      autonomous,
      rl,
      log,
      confirm,
      humanConsultSession,
      onAgentStreamChunk,
    });
    pauseReadlineForBackgroundWork(rl);
  }

  assertNotCancelledOrBlocked(paths, "After planning");

  state = readState(paths);
  if (
    state.phase === "PREPARING_WORKTREES" ||
    state.phase === "WRITING_TESTS" ||
    state.phase === "IMPLEMENTING_PARALLEL"
  ) {
    if (loaded.config.repo.requireCleanTree) {
      const st = execGit({
        cwd: task.repo.localPath,
        argv: ["status", "--porcelain"],
      });
      if (st.ok && st.stdout.trim()) {
        throw new Error(
          "Repository has a dirty working tree (repo.requireCleanTree is true). Commit or stash first.",
        );
      }
    }
    pauseReadlineForBackgroundWork(rl);
    log("Writing tests, then implementing (worktrees + test writer + implementation agents)...");
    await runImplementCandidates({
      loaded,
      paths,
      consult: humanConsultSession?.hooks,
      onAgentStreamChunk,
    });
    log("Implementation step complete.");
  }

  assertNotCancelledOrBlocked(paths, "After implementation");

  state = readState(paths);
  if (
    state.phase === "VERIFYING_CANDIDATES" ||
    state.phase === "CLEANUP_RECOMMENDATIONS" ||
    state.phase === "REVIEWING_PASSES"
  ) {
    pauseReadlineForBackgroundWork(rl);
    log("Verifying candidates and running review passes...");
    await runVerifyAndReviews({
      loaded,
      paths,
      consult: humanConsultSession?.hooks,
      onAgentStreamChunk,
    });
    log("Verification step complete.");
  }

  assertNotCancelledOrBlocked(paths, "After verification");

  state = readState(paths);
  if (
    state.phase === "SELECTING_CANDIDATE" ||
    state.phase === "FINALIZING" ||
    state.phase === "CREATING_PR"
  ) {
    pauseReadlineForBackgroundWork(rl);
    log("Finalizing branch and opening pull request...");
    await runFinalizeAndCreatePr({
      loaded,
      paths,
      consult: humanConsultSession?.hooks,
      onAgentStreamChunk,
    });
    log("Finalize step complete.");
  }

  assertNotCancelledOrBlocked(paths, "After finalize");

  state = readState(paths);
  const prUrl = state.prUrl;
  if (!prUrl) {
    throw new Error("No PR URL available (finalize may have failed).");
  }

  pauseReadlineForBackgroundWork(rl);

  if (workflowSkips("prMonitor", loaded.config.workflow)) {
    logWorkflowStepSkipped("prMonitor");
    log("Skipping PR monitor (workflow.skipSteps).");
    log("Interactive full run complete.");
    return "skipped_pr_monitor_config";
  }

  log(`Monitoring PR, addressing CI/comments; will merge when approved — ${prUrl}`);
  const outcome = await monitorPullRequest({
    loaded,
    paths,
    prUrl,
    mergeWhenApproved: true,
    mergeStrategy,
    onLog: log,
    consult: humanConsultSession?.hooks,
    onAgentStreamChunk,
  });

  log("Interactive full run complete.");
  return outcome;
}
