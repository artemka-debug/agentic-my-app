import type { LoadedConfig } from "../config/loadConfig.js";
import { logWorkflowStepSkipped, workflowSkips } from "../config/workflowSkipSteps.js";
import { monitorPullRequest } from "../monitor/prMonitor.js";
import {
  readState,
  readTaskInput,
  runPaths,
  writeState,
} from "../runs/runWorkspace.js";
import { execGit } from "../util/git.js";
import { runFinalizeAndCreatePr } from "./finalizePr.js";
import { runImplementCandidates } from "./implementCandidates.js";
import { runPoAndDecomposition } from "./planning.js";
import { runVerifyAndReviews } from "./verifyAndReview.js";

type Paths = ReturnType<typeof runPaths>;

function assertCleanMainRepoIfRequired(
  loaded: LoadedConfig,
  taskRepoLocalPath: string,
): string | undefined {
  if (!loaded.config.repo.requireCleanTree) return undefined;
  const st = execGit({ cwd: taskRepoLocalPath, argv: ["status", "--porcelain"] });
  if (!st.ok) return st.stderr || "git status failed";
  if (st.stdout.trim()) {
    return "Repository has a dirty working tree (repo.requireCleanTree is true). Commit or stash before continuing.";
  }
  return undefined;
}

export async function advanceWorkflow(args: {
  loaded: LoadedConfig;
  paths: Paths;
  autonomous: boolean;
  /** When true, after PR creation block until merge/close or max monitor loops */
  followPr?: boolean;
}): Promise<void> {
  let state = readState(args.paths);

  if (state.cancelRequested) {
    state.phase = "CANCELLED";
    writeState(args.paths, state);
    return;
  }

  const task = readTaskInput(args.paths);

  if (
    state.phase === "NEW" ||
    state.phase === "INTAKING_TASK" ||
    state.phase === "PO_DRAFTING" ||
    state.phase === "AWAITING_SPEC_APPROVAL" ||
    state.phase === "DECOMPOSING" ||
    state.phase === "AWAITING_DECOMPOSITION_APPROVAL"
  ) {
    await runPoAndDecomposition({
      loaded: args.loaded,
      paths: args.paths,
      task,
      autonomous: args.autonomous,
    });
    state = readState(args.paths);
    if (
      state.phase === "AWAITING_SPEC_APPROVAL" ||
      state.phase === "AWAITING_DECOMPOSITION_APPROVAL" ||
      state.phase === "CANCELLED"
    ) {
      return;
    }
  }

  if (
    state.phase === "PREPARING_WORKTREES" ||
    state.phase === "WRITING_TESTS" ||
    state.phase === "IMPLEMENTING_PARALLEL"
  ) {
    const dirtyErr = assertCleanMainRepoIfRequired(args.loaded, task.repo.localPath);
    if (dirtyErr) {
      state.phase = "BLOCKED_NEEDS_USER";
      state.lastError = dirtyErr;
      writeState(args.paths, state);
      return;
    }
    await runImplementCandidates({ loaded: args.loaded, paths: args.paths });
    state = readState(args.paths);
    if (state.phase === "CANCELLED") return;
  }

  if (
    state.phase === "VERIFYING_CANDIDATES" ||
    state.phase === "CLEANUP_RECOMMENDATIONS" ||
    state.phase === "REVIEWING_PASSES"
  ) {
    await runVerifyAndReviews({ loaded: args.loaded, paths: args.paths });
    state = readState(args.paths);
    if (state.phase === "CANCELLED" || state.phase === "BLOCKED_NEEDS_USER") return;
  }

  if (
    state.phase === "SELECTING_CANDIDATE" ||
    state.phase === "FINALIZING" ||
    state.phase === "CREATING_PR"
  ) {
    await runFinalizeAndCreatePr({ loaded: args.loaded, paths: args.paths });
    state = readState(args.paths);
    if (state.phase === "CANCELLED" || state.phase === "BLOCKED_NEEDS_USER") return;
  }

  if (
    args.followPr &&
    state.prUrl &&
    state.phase === "MONITORING_PR" &&
    !workflowSkips("prMonitor", args.loaded.config.workflow)
  ) {
    await monitorPullRequest({
      loaded: args.loaded,
      paths: args.paths,
      prUrl: state.prUrl,
      mergeWhenApproved: true,
    });
  } else if (
    args.followPr &&
    state.prUrl &&
    state.phase === "MONITORING_PR" &&
    workflowSkips("prMonitor", args.loaded.config.workflow)
  ) {
    logWorkflowStepSkipped("prMonitor");
  }
}

export function requestCancel(paths: Paths): void {
  const s = readState(paths);
  s.cancelRequested = true;
  writeState(paths, s);
}
