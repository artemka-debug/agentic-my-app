import "../util/elevateAbortListenerBudget.js";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { workflowSkips, logWorkflowStepSkipped } from "../config/workflowSkipSteps.js";
import type { LoadedConfig } from "../config/loadConfig.js";
import { resolveCursorApiKey } from "../config/loadConfig.js";
import { ghJson, ghOk } from "../util/gh.js";
import { createLogger } from "../logging/logger.js";
import {
  readJsonFile,
  readState,
  readTaskInput,
  runPaths,
  writeState,
} from "../runs/runWorkspace.js";
import { interpolate, readPromptFile } from "../prompts/loadPrompt.js";
import { withWorkflowStepPrompt } from "../prompts/stepPrompt.js";
import { runAgentTurn, type HumanConsultHooks, WorkflowCancelledError } from "../sdk/runAgentTurn.js";
import { envStreamExplicitlyEnabled } from "../util/agenticEnv.js";
import { execGit, gitTopLevel } from "../util/git.js";
import {
  buildCommentFeedbackBlock,
  ellipsis,
  fetchUnaddressedRootFeedback,
  loadAddressedFeedback,
  postThreadReply,
  prependAgenticPlatformReplyPrefix,
  resolvePrCoordinates,
  saveAddressedFeedback,
  type AddressedPrFeedback,
  type PendingRootFeedback,
  type PrCoordinates,
} from "./prFeedbackGithub.js";
import { monitorDebugLog } from "./monitorDebug.js";

type Paths = ReturnType<typeof runPaths>;

export type MonitorMergeStrategy = "merge" | "squash" | "rebase";

/** How the monitor loop ended (for CLI exit / logging). */
export type MonitorPullRequestExitReason =
  | "completed_upstream_merged"
  | "completed_upstream_closed"
  | "completed_merged_by_monitor"
  | "stopped_cancelled"
  | "stopped_missing_cursor_api_key"
  | "max_polls_expired"
  | "skipped_pr_monitor_config";

function mergeAddressed(
  base: AddressedPrFeedback,
  updates: { issue?: number[]; review?: number[]; pullReview?: number[] },
): AddressedPrFeedback {
  const issue = new Set(base.issueCommentIds);
  const review = new Set(base.reviewCommentIds);
  const pull = new Set(base.pullReviewIds ?? []);
  for (const id of updates.issue ?? []) issue.add(id);
  for (const id of updates.review ?? []) review.add(id);
  for (const id of updates.pullReview ?? []) pull.add(id);
  return {
    issueCommentIds: [...issue].sort((a, b) => a - b),
    reviewCommentIds: [...review].sort((a, b) => a - b),
    pullReviewIds: [...pull].sort((a, b) => a - b),
  };
}

function buildReplyBody(args: {
  item: PendingRootFeedback;
  shortSha: string;
  hadLocalCommitsBeforePush: boolean;
  pushOk: boolean;
}): string {
  const quoted = ellipsis(args.item.body, 500);
  let pushLine: string;
  if (!args.pushOk) {
    pushLine =
      "I attempted changes but `git push` failed in this loop; please check the monitor logs.";
  } else if (args.hadLocalCommitsBeforePush) {
    pushLine = `I pushed an update; current HEAD is \`${args.shortSha}\`.`;
  } else {
    pushLine = `No new commits were needed in this loop; branch is at \`${args.shortSha}\`.`;
  }
  const core = `@${args.item.author} Thanks for the feedback.\n\n${pushLine}\n\n> ${quoted.replace(/\n/g, " ")}\n`;
  return prependAgenticPlatformReplyPrefix(core);
}

export async function monitorPullRequest(args: {
  loaded: LoadedConfig;
  paths: Paths;
  prUrl: string;
  maxLoops?: number;
  /** When set, run `gh pr merge` once the PR is APPROVED with passing checks. */
  mergeWhenApproved?: boolean;
  mergeStrategy?: MonitorMergeStrategy;
  /** Verbose human-oriented log line (e.g. from `agentic-my-app full`). */
  onLog?: (message: string) => void;
  /** Tool consult during automated PR fix agent turns (e.g. Telegram). */
  consult?: HumanConsultHooks;
  onAgentStreamChunk?: (text: string) => void;
}): Promise<MonitorPullRequestExitReason> {
  const state = readState(args.paths);
  const log = createLogger({
    runId: state.runId,
    component: "monitor.pr",
    jsonlPath: path.join(args.paths.monitorDir, "events.jsonl"),
  });
  const intervalSec = args.loaded.config.monitoring.pollIntervalSeconds;
  const maxLoops =
    args.maxLoops ?? args.loaded.config.monitoring.maxFixLoops;
  const maxPolls = args.loaded.config.monitoring.maxPollCycles;
  const addressedPath = path.join(
    args.paths.monitorDir,
    "addressed-feedback.json",
  );
  let polls = 0;
  let fixLoops = 0;
  let prFixSkippedNotice = false;
  let outcome: MonitorPullRequestExitReason = "max_polls_expired";

  monitorDebugLog("monitor_enter_loop", {
    runId: state.runId,
    prUrl: args.prUrl,
    maxPolls,
    pollIntervalSeconds: intervalSec,
    mergeWhenApproved: Boolean(args.mergeWhenApproved),
    maxLoopsConfig: args.maxLoops ?? args.loaded.config.monitoring.maxFixLoops,
  });

  while (polls < maxPolls) {
    polls += 1;
    const live = readState(args.paths);
    if (live.cancelRequested) {
      log.log("info", "monitor_cancelled", {});
      outcome = "stopped_cancelled";
      break;
    }
    const view = ghJson<{
      url?: string;
      state?: string;
      mergeable?: string;
      statusCheckRollup?: unknown;
      reviewDecision?: string | null;
    }>({
      argv: [
        "pr",
        "view",
        args.prUrl,
        "--json",
        "url,state,mergeable,statusCheckRollup,reviewDecision",
      ],
      cwd: args.loaded.cwd,
    });
    if (!view.ok) {
      log.log("warn", "pr_view_failed", { error: view.error });
      await delay(intervalSec * 1000);
      continue;
    }
    const line = `${new Date().toISOString()} ${JSON.stringify(view.data)}\n`;
    fs.appendFileSync(path.join(args.paths.monitorDir, "poll.jsonl"), line, "utf8");
    log.log("info", "pr_poll", {
      state: view.data.state,
      mergeable: view.data.mergeable,
    });

    if (view.data.state === "MERGED") {
      args.onLog?.("[monitor] PR is MERGED; stopping.");
      const s = readState(args.paths);
      s.phase = "COMPLETED";
      writeState(args.paths, s);
      outcome = "completed_upstream_merged";
      break;
    }
    if (view.data.state === "CLOSED") {
      args.onLog?.("[monitor] PR is CLOSED; stopping.");
      const s = readState(args.paths);
      s.phase = "COMPLETED";
      writeState(args.paths, s);
      outcome = "completed_upstream_closed";
      break;
    }

    const rollup = view.data.statusCheckRollup;
    const failed =
      Array.isArray(rollup) &&
      rollup.some(
        (c) =>
          c &&
          typeof c === "object" &&
          (c as { state?: string }).state === "FAILURE",
      );

    const reviewDecisionDisplay =
      view.data.reviewDecision == null
        ? "none"
        : String(view.data.reviewDecision);
    args.onLog?.(
      `[monitor] poll ${polls}/${maxPolls}: prState=${view.data.state ?? "?"} mergeable=${view.data.mergeable ?? "?"} reviewDecision=${reviewDecisionDisplay} ciFailed=${failed}`,
    );

    let coords: PrCoordinates | null = resolvePrCoordinates({
      prRef: args.prUrl,
      cwd: args.loaded.cwd,
    });
    if (!coords) {
      log.log("warn", "pr_coords_unresolved", { prUrl: args.prUrl });
    }

    const addressed = loadAddressedFeedback(addressedPath);
    const pendingRoots: PendingRootFeedback[] = coords
      ? fetchUnaddressedRootFeedback({
          coords,
          cwd: args.loaded.cwd,
          addressed,
        })
      : [];

    const shouldProcessComments = pendingRoots.length > 0;
    const shouldProcessCi =
      failed && args.loaded.config.workflow.autonomy.allowAutoPushPrFixes;

    monitorDebugLog("monitor_tick", {
      pollIndex: polls,
      maxPolls,
      coordsResolved: Boolean(coords),
      pendingFeedbackCount: pendingRoots.length,
      shouldProcessComments,
      shouldProcessCi,
      ciFailureInRollup: failed,
      fixLoops,
      maxFixLoopsConfigured: maxLoops,
      allowFixes: args.loaded.config.workflow.autonomy.allowAutoPushPrFixes,
    });

    log.log("debug", "monitor_feedback_tick", {
      pendingCount: pendingRoots.length,
      shouldProcessComments,
      shouldProcessCi,
    });

    const wantsFixAttempt =
      args.loaded.config.workflow.autonomy.allowAutoPushPrFixes &&
      fixLoops < maxLoops &&
      (shouldProcessComments || shouldProcessCi);
    const skipPrFixAgent = workflowSkips("prFix", args.loaded.config.workflow);

    if (wantsFixAttempt && skipPrFixAgent && !prFixSkippedNotice) {
      logWorkflowStepSkipped("prFix");
      args.onLog?.(
        "[monitor] prFix skipped (workflow.skipSteps); continuing to poll without automated fix pushes.",
      );
      prFixSkippedNotice = true;
    }

    if (wantsFixAttempt && !skipPrFixAgent) {
      const apiKey = resolveCursorApiKey(args.loaded);
      if (!apiKey) {
        log.log("error", "monitor_missing_api_key", {});
        outcome = "stopped_missing_cursor_api_key";
        break;
      }
      const task = readTaskInput(args.paths);
      gitTopLevel(task.repo.localPath);
      const cand = live.selectedCandidateId
        ? readJsonFile<{ worktreePath?: string; branch?: string }>(
            path.join(
              args.paths.candidatesDir,
              `${live.selectedCandidateId}.json`,
            ),
          )
        : {};
      if (cand.worktreePath && cand.branch) {
        execGit({
          cwd: cand.worktreePath,
          argv: ["pull", "origin", cand.branch],
        });

        const commentBlock = shouldProcessComments
          ? buildCommentFeedbackBlock(pendingRoots)
          : "";
        const fixPrompt = interpolate(readPromptFile("fixPr.md"), {
          PR_URL: args.prUrl,
          CONTEXT: JSON.stringify(view.data).slice(0, 4000),
          COMMENT_FEEDBACK:
            commentBlock.trim() ||
            "_(No new root-level PR comments queued for this pass — addressing CI rollup only.)_",
        });

        try {
          await runAgentTurn({
            apiKey,
            modelId: args.loaded.config.runtime.cursor.models.finalizer,
            cwd: cand.worktreePath,
            prompt: withWorkflowStepPrompt(
              fixPrompt,
              args.loaded,
              "prFix",
            ),
            settingSources: args.loaded.config.runtime.cursor.settingSources,
            transcriptPath: path.join(
              args.paths.transcriptDir,
              `fix-${fixLoops}.txt`,
            ),
            streamStdout: envStreamExplicitlyEnabled(),
            consult: args.consult,
            onStreamChunk: args.onAgentStreamChunk,
            shouldAbort: () => readState(args.paths).cancelRequested,
          });
        } catch (e) {
          if (e instanceof WorkflowCancelledError) {
            const s = readState(args.paths);
            s.phase = "CANCELLED";
            writeState(args.paths, s);
            outcome = "stopped_cancelled";
            break;
          }
          throw e;
        }

        execGit({
          cwd: cand.worktreePath,
          argv: ["pull", "--ff-only", "origin", cand.branch],
        });

        const ahead = execGit({
          cwd: cand.worktreePath,
          argv: [
            "rev-list",
            "--count",
            `origin/${cand.branch}..HEAD`,
          ],
        });
        const hadLocalCommits =
          ahead.ok && Number.parseInt(ahead.stdout.trim(), 10) > 0;

        const push = execGit({
          cwd: cand.worktreePath,
          argv: ["push", "origin", cand.branch],
        });
        log.log("info", "fix_push", { ok: push.ok });

        const headSha = execGit({
          cwd: cand.worktreePath,
          argv: ["rev-parse", "--short", "HEAD"],
        });
        const shortSha = headSha.ok
          ? headSha.stdout.trim().slice(0, 40)
          : "unknown";

        if (coords && shouldProcessComments) {
          const skipRepliesDueToPushFailure =
            hadLocalCommits && !push.ok;
          if (skipRepliesDueToPushFailure) {
            log.log("warn", "push_failed_skip_comment_replies", {
              branch: cand.branch,
              stderr: push.stderr?.slice?.(0, 400),
            });
          }
          let nextAddr = addressed;
          if (!skipRepliesDueToPushFailure) {
            for (const item of pendingRoots) {
              const body = buildReplyBody({
                item,
                shortSha,
                hadLocalCommitsBeforePush: hadLocalCommits,
                pushOk: push.ok,
              });
              const r = postThreadReply({
                cwd: args.loaded.cwd,
                coords,
                item,
                body,
              });
              if (r.ok && push.ok) {
                log.log("info", "comment_reply_posted", {
                  kind: item.kind,
                  id: item.id,
                });
                nextAddr =
                  item.kind === "issue"
                    ? mergeAddressed(nextAddr, { issue: [item.id] })
                    : item.kind === "review_submission"
                      ? mergeAddressed(nextAddr, {
                          pullReview: [item.id],
                        })
                      : mergeAddressed(nextAddr, { review: [item.id] });
              } else {
                log.log("warn", "comment_reply_failed", {
                  kind: item.kind,
                  id: item.id,
                  stderr: r.stderr?.slice?.(0, 500),
                  pushOk: push.ok,
                });
              }
            }
          }
          saveAddressedFeedback(addressedPath, nextAddr);
        }

        fixLoops += 1;
      } else if (shouldProcessComments || shouldProcessCi) {
        log.log("warn", "monitor_missing_worktree", {
          candidateId: live.selectedCandidateId,
        });
      }
    }

    if (
      args.mergeWhenApproved &&
      view.data.state === "OPEN" &&
      !failed &&
      !shouldProcessComments
    ) {
      const rd =
        view.data.reviewDecision === null ||
        view.data.reviewDecision === undefined
          ? ""
          : String(view.data.reviewDecision);
      const conflict = view.data.mergeable === "CONFLICTING";
      if (rd === "APPROVED" && !conflict) {
        const strat = args.mergeStrategy ?? "merge";
        const flag =
          strat === "squash"
            ? "--squash"
            : strat === "rebase"
              ? "--rebase"
              : "--merge";
        args.onLog?.(`[monitor] opening merge with strategy "${strat}"`);
        const mr = ghOk({
          cwd: args.loaded.cwd,
          argv: ["pr", "merge", args.prUrl, flag],
        });
        if (mr.ok) {
          log.log("info", "pr_merged", {});
          const s = readState(args.paths);
          s.phase = "COMPLETED";
          writeState(args.paths, s);
          args.onLog?.("[monitor] merge succeeded.");
          outcome = "completed_merged_by_monitor";
          break;
        }
        log.log("warn", "pr_merge_failed", { stderr: mr.stderr });
        args.onLog?.(
          `[monitor] gh pr merge failed: ${mr.stderr.trim().slice(0, 500)}`,
        );
      }
    }

    await delay(intervalSec * 1000);
  }

  monitorDebugLog("monitor_exit", { outcome });
  return outcome;
}
